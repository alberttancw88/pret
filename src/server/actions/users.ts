'use server';

// M6 Users, roles, access & audit Server Actions (W2-002). Contract: src/server/contracts/users.ts.
// Each action: requireUser([...roles]) → zod → withUserTx (RLS + DB guards: no self-change,
// last active SA, external = ADM only, ADM scope) → audit (trigger / audit.write_admin_event /
// audit.write_access for exports & reveals) → ActionResult.

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { sql, withJobTx, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { writeAccess } from '../audit';
import { companyName, createEmployeeUser, createInvitation, deliverInvitation, inviteMessage, setInviteSchedule } from '../lib/invites';
import { createSupabaseAdminClient } from '../auth/supabase';
import { appOrigin } from '../email';
import { env } from '../env';
import { confirmUpload, getDownloadUrl, requestUpload } from '../storage';
import { fail, NO_ACCESS, runAction, type Input } from '../lib/action-helpers';
import { csvDate, csvDateTime, csvFile } from '../lib/csv';
import { formatDateTime } from '../../lib/format/date';
import {
  accessReviewMonthSchema, auditListParamsSchema, disableUserSchema, inviteUserSchema, loginHistoryParamsSchema,
  markAccessReviewedSchema, publishPrivacyNoticeSchema, requestPrivacyNoticeUploadSchema, revealAuditEntrySchema,
  saveUserRolesSchema, updateAccessWindowSchema, updateUserAccountSchema, userIdSchema, userListParamsSchema,
  AUDIT_ACTION_LABELS, DATA_CATEGORY_LABELS, LOGIN_OUTCOME_LABELS, ROLE_PERMISSION_MATRIX, USER_STATUS_LABELS, USER_TYPE_LABELS,
  type ActionResult, type AuditEntryDetail, type CsvFile, type InviteUserResult, type PrivilegedRole, type SaveUserRolesResult,
  type UploadIntent, type UserStatus,
} from '../contracts/users';
import { userRows, loginHistoryRows, SYSTEM_ACTOR_ID } from '../queries/users';
import { accessReview, auditEntry, auditRows } from '../queries/audit';

const ADMIN: Role[] = ['ADM', 'SA'];
const SA: Role[] = ['SA'];
const ANY: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
const NOT_FOUND = { ok: false as const, error: NO_ACCESS };

type Target = { id: string; user_type: 'employee' | 'external'; status: UserStatus; auth_user_id: string | null; login_email: string; display_name: string; roles: PrivilegedRole[] };

/** The target user as visible to the caller under RLS (ADM sees only employee users without privileged roles). */
async function target(tx: Tx, userId: string, lock = false): Promise<Target | null> {
  const r = await sql<Target>`
    select u.id, u.user_type::text as user_type, u.status::text as status, u.auth_user_id, u.login_email::text as login_email, u.display_name,
           array(select r.role::text from app.user_roles r where r.user_id = u.id and r.revoked_at is null) as roles
      from app.app_users u where u.id = ${userId}::uuid and u.id <> ${SYSTEM_ACTOR_ID}::uuid ${lock ? sql`for update of u` : sql``}`.execute(tx);
  return r.rows[0] ?? null;
}

// Invitations (ADR-0014) — shared helpers in ../lib/invites (token only in the email; DB keeps its SHA-256).

export async function inviteUser(input: Input): Promise<ActionResult<InviteUserResult>> {
  return runAction(ADMIN, inviteUserSchema, input, async (d, { user, ctx }) => {
    if (d.userType === 'employee') {
      // A6 employee branch (F-ADM-02, W2-003): login email = work email; roles SA only.
      if (d.roles.length && !user.roles.includes('SA')) return fail('Only a Super Admin can give privileged roles.', { roles: 'Only a Super Admin can give privileged roles.' });
      const scheduled = d.sendMode === 'schedule' && d.scheduledSendDate ? d.scheduledSendDate : null;
      const created = await withUserTx(ctx, async (tx) => {
        const emp = (await sql<{ id: string; status: string; has_user: boolean; today: string }>`
          select e.id, e.status::text as status, exists (select 1 from app.employee_portal_accounts(array[e.id]) pa) as has_user,
                 app.today_myt()::text as today
            from app.employees e where e.id = ${d.employeeId}::uuid`.execute(tx)).rows[0];
        if (!emp) return 'missing' as const;
        if (emp.has_user) return 'exists' as const;
        if (!['pending_join', 'on_probation', 'confirmed', 'notice_period'].includes(emp.status)) return 'inactive' as const;
        const u = await createEmployeeUser(tx, d.employeeId, scheduled && scheduled > emp.today ? scheduled : null);
        if (d.displayName) await sql`update app.app_users set display_name = ${d.displayName} where id = ${u.userId}::uuid`.execute(tx);
        if (d.accessStartDate) await sql`update app.app_users set access_start_date = ${d.accessStartDate}::date where id = ${u.userId}::uuid`.execute(tx);
        for (const role of d.roles) {
          await sql`insert into app.user_roles (user_id, role, granted_by) values (${u.userId}::uuid, ${role}::app.privileged_role, app.current_app_user_id())`.execute(tx);
        }
        const now = !(scheduled && scheduled > emp.today);
        const inv = now ? await createInvitation(tx, u.userId) : null;
        return { ...u, displayName: d.displayName ?? u.displayName, inv, co: await companyName(tx), scheduledFor: now ? null : scheduled };
      });
      if (created === 'missing') return fail('Employee not found.', { employeeId: 'Employee not found.' });
      if (created === 'exists') return fail('This employee already has a user account.', { employeeId: 'This employee already has a user account.' });
      if (created === 'inactive') return fail('Only active or joining employees can be invited.', { employeeId: 'Only active or joining employees can be invited.' });
      if (!created.inv) {
        return { userId: created.userId, emailSent: false, expiresAt: '', message: `Invitation scheduled for ${created.scheduledFor!.split('-').reverse().join('/')}.` };
      }
      const sent = await deliverInvitation(created.inv, { email: created.email, displayName: created.displayName }, created.co);
      return { userId: created.userId, emailSent: sent, expiresAt: created.inv.expiresAt.toISOString(), message: inviteMessage(sent) };
    }
    if (!user.roles.includes('SA')) return fail('Only a Super Admin can create external administrator accounts.');
    const created = await withUserTx(ctx, async (tx) => {
      const u = await sql<{ id: string }>`
        insert into app.app_users (user_type, login_email, display_name, access_start_date, access_end_date, service_provider)
        values ('external', ${d.loginEmail}, ${d.displayName}, ${d.accessStartDate}::date, ${d.accessEndDate}::date, ${d.serviceProvider})
        returning id`.execute(tx);
      const userId = u.rows[0]!.id;
      await sql`insert into app.user_roles (user_id, role, granted_by) values (${userId}::uuid, 'ADM', app.current_app_user_id())`.execute(tx);
      const inv = await createInvitation(tx, userId);
      return { userId, inv, co: await companyName(tx) };
    });
    const sent = await deliverInvitation(created.inv, { email: d.loginEmail, displayName: d.displayName }, created.co);
    return { userId: created.userId, emailSent: sent, expiresAt: created.inv.expiresAt.toISOString(), message: inviteMessage(sent) };
  }, { loginEmail: 'loginEmail' });
}

export async function resendInvite(input: Input): Promise<ActionResult<InviteUserResult>> {
  return runAction(ADMIN, userIdSchema, input, async (d, { ctx }) => {
    const r = await withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId);
      if (!t) return null;
      if (t.status !== 'invited' || t.auth_user_id) return 'state' as const;
      const inv = await createInvitation(tx, t.id);
      await setInviteSchedule(tx, t.id, null);
      return { t, inv, co: await companyName(tx) };
    });
    if (!r) return NOT_FOUND;
    if (r === 'state') return fail('This user is not waiting for an invitation.');
    const sent = await deliverInvitation(r.inv, { email: r.t.login_email, displayName: r.t.display_name }, r.co);
    return { userId: r.t.id, emailSent: sent, expiresAt: r.inv.expiresAt.toISOString(), message: inviteMessage(sent) };
  });
}

// ---------------------------------------------------------------------------
// A7 Roles, account, access window, status
// ---------------------------------------------------------------------------
export async function saveUserRoles(input: Input): Promise<ActionResult<SaveUserRolesResult>> {
  return runAction(SA, saveUserRolesSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail("You can't change your own roles.");
    return withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId, true);
      if (!t) return NOT_FOUND;
      if (t.user_type === 'external' && d.roles.includes('SA'))
        return fail('External administrators can hold the Admin role only.', { roles: 'External administrators can hold the Admin role only.' });
      const granted = d.roles.filter((r) => !t.roles.includes(r));
      const revoked = t.roles.filter((r) => !d.roles.includes(r));
      for (const role of granted) {
        await sql`insert into app.user_roles (user_id, role, granted_by) values (${t.id}::uuid, ${role}::app.privileged_role, app.current_app_user_id())`.execute(tx);
      }
      for (const role of revoked) {
        await sql`update app.user_roles set revoked_at = now() where user_id = ${t.id}::uuid and role = ${role}::app.privileged_role and revoked_at is null`.execute(tx);
      }
      return { granted, revoked };
    });
  });
}

export async function updateUserAccount(input: Input): Promise<ActionResult> {
  return runAction(SA, updateUserAccountSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail("You can't change your own account here.");
    return withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId, true);
      if (!t) return NOT_FOUND;
      if (t.user_type === 'external' && !d.serviceProvider)
        return fail('Service provider is required for external administrators.', { serviceProvider: 'Service provider is required for external administrators.' });
      const email = d.loginEmail && d.loginEmail !== t.login_email ? d.loginEmail : t.login_email;
      if (email !== t.login_email && t.auth_user_id)
        return fail('The login email cannot change after the invitation was accepted.', { loginEmail: 'The login email cannot change after the invitation was accepted.' });
      await sql`update app.app_users set display_name = ${d.displayName}, login_email = ${email},
                  service_provider = ${t.user_type === 'external' ? d.serviceProvider : null}
                where id = ${t.id}::uuid`.execute(tx);
      return {};
    });
  }, { loginEmail: 'loginEmail' });
}

export async function updateUserAccessWindow(input: Input): Promise<ActionResult> {
  return runAction(SA, updateAccessWindowSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail("You can't change your own access.");
    return withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId, true);
      if (!t) return NOT_FOUND;
      if (t.user_type === 'external' && !d.accessEndDate)
        return fail('External administrators need an access end date.', { accessEndDate: 'External administrators need an access end date.' });
      await sql`update app.app_users set access_start_date = ${d.accessStartDate}::date, access_end_date = ${d.accessEndDate}::date,
                  status = case when status = 'expired' and (${d.accessEndDate}::date is null or ${d.accessEndDate}::date >= app.today_myt())
                                 and auth_user_id is not null then 'active'::app.user_status else status end
                where id = ${t.id}::uuid`.execute(tx);
      return {};
    });
  });
}

/** Best-effort Supabase Auth ban/unban (refresh tokens). PRET's live status check is the real control. */
async function setAuthBan(authUserId: string | null, banned: boolean): Promise<void> {
  if (!authUserId) return;
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  try {
    await admin.auth.admin.updateUserById(authUserId, { ban_duration: banned ? '876000h' : 'none' });
  } catch {
    // ignored: the database already refuses the user
  }
}

export async function disableUser(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, disableUserSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail("You can't disable your own account.");
    const t = await withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId, true);
      if (!t) return null;
      if (t.status === 'disabled') return t;
      const r = await sql`update app.app_users set status = 'disabled', disabled_reason = ${d.reason} where id = ${t.id}::uuid`.execute(tx);
      if (Number(r.numAffectedRows ?? 0) === 0) return null;
      return t;
    });
    if (!t) return NOT_FOUND;
    await setAuthBan(t.auth_user_id, true);
    return {};
  });
}

export async function enableUser(input: Input): Promise<ActionResult<{ status: UserStatus }>> {
  return runAction(ADMIN, userIdSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail("You can't change your own status.");
    const r = await withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId, true);
      if (!t) return null;
      if (t.status !== 'disabled') return { t, status: t.status, changed: false };
      const next: UserStatus = t.auth_user_id ? 'active' : 'invited';
      const u = await sql`update app.app_users set status = ${next}::app.user_status, disabled_reason = null where id = ${t.id}::uuid`.execute(tx);
      if (Number(u.numAffectedRows ?? 0) === 0) return null;
      return { t, status: next, changed: true };
    });
    if (!r) return NOT_FOUND;
    if (r.changed) await setAuthBan(r.t.auth_user_id, false);
    return { status: r.status };
  });
}

export async function unlockUser(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, userIdSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail("You can't unlock your own account.");
    return withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId, true);
      if (!t) return NOT_FOUND;
      await sql`update app.app_users set failed_login_count = 0, locked_until = null,
                  status = case when status = 'locked' then 'active'::app.user_status else status end
                where id = ${t.id}::uuid`.execute(tx);
      return {};
    });
  });
}

export async function sendPasswordReset(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, userIdSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail('Use "Forgot password" on the sign-in page to reset your own password.');
    const t = await withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId);
      if (!t) return null;
      if (t.status !== 'active' || !t.auth_user_id) return 'state' as const;
      await sql`select audit.write_admin_event('update'::app.audit_action, 'user_password_reset', ${t.id}::uuid, ${t.login_email}, null)`.execute(tx);
      return t;
    });
    if (!t) return NOT_FOUND;
    if (t === 'state') return fail('A password reset can be sent only to an active user who has accepted the invitation.');
    const client = createClient(env.supabaseUrl(), env.supabasePublishableKey(), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { error } = await client.auth.resetPasswordForEmail(t.login_email, { redirectTo: `${await appOrigin()}/reset-password` });
    if (error) return fail("Couldn't send the reset email right now. Please try again later.");
    return {};
  });
}

export async function resetUserMfa(input: Input): Promise<ActionResult> {
  return runAction(SA, userIdSchema, input, async (d, { user, ctx }) => {
    if (d.userId === user.id) return fail("You can't reset your own two-factor authentication here.");
    const admin = createSupabaseAdminClient();
    if (!admin) return fail('Two-factor reset is not available yet: the server’s Supabase secret key (SUPABASE_SECRET_KEY) is not configured.');
    const t = await withUserTx(ctx, async (tx) => {
      const t = await target(tx, d.userId);
      if (!t || !t.auth_user_id) return null;
      await sql`select audit.write_admin_event('update'::app.audit_action, 'user_mfa_reset', ${t.id}::uuid, ${t.login_email}, null)`.execute(tx);
      return t;
    });
    if (!t) return NOT_FOUND;
    try {
      const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: t.auth_user_id! });
      if (error) return fail("Couldn't reach the authentication service. Please try again.");
      for (const f of data?.factors ?? []) {
        const del = await admin.auth.admin.mfa.deleteFactor({ id: f.id, userId: t.auth_user_id! });
        if (del.error) return fail("Couldn't remove the user's authenticator. Please try again.");
      }
    } catch {
      return fail("Couldn't reach the authentication service. Please try again.");
    }
    await withJobTx('mfa-reset', async (tx) => {
      await sql`update app.app_users set mfa_enrolled = false where id = ${t.id}::uuid`.execute(tx);
      await sql`update app.app_sessions set ended_at = now(), end_reason = 'mfa_reset' where user_id = ${t.id}::uuid and ended_at is null`.execute(tx);
    });
    return {};
  });
}

// ---------------------------------------------------------------------------
// Exports (each writes audit.access_log — F-ADM-10)
// ---------------------------------------------------------------------------
export async function exportUsersCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, userListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await userRows(tx, p, true);
      await writeAccess(tx, { action: 'export', entityType: 'app_users', recordCount: rows.length, categories: ['contact'], fields: ['login_email'] });
      return csvFile('users', ['Display name', 'Login email', 'User type', 'Linked employee', 'Roles', 'Status', 'Last login', 'MFA', 'Access start', 'Access end', 'Service provider'],
        rows.map((r) => [r.displayName, r.loginEmail, USER_TYPE_LABELS[r.userType], r.employeeNo ?? '',
          [...r.roles.map((x) => (x === 'SA' ? 'Super Admin' : 'Admin')), ...(r.directReportees ? [`Manager (${r.directReportees} reportees)`] : [])].join('; '),
          USER_STATUS_LABELS[r.status], csvDateTime(r.lastLoginAt), r.mfaEnrolled ? 'Enrolled' : 'Not enrolled',
          csvDate(r.accessStartDate), csvDate(r.accessEndDate), r.serviceProvider]));
    }));
}

export async function exportLoginHistoryCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(SA, loginHistoryParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await loginHistoryRows(tx, p, true);
      await writeAccess(tx, { action: 'export', entityType: 'login_events', entityId: p.userId, recordCount: rows.length });
      return csvFile('login-history', ['Date/time', 'Result', 'IP', 'Device', 'Detail'],
        rows.map((r) => [csvDateTime(r.occurredAt), LOGIN_OUTCOME_LABELS[r.outcome], r.ip, r.userAgent, r.detail]));
    }));
}

export async function exportRolePermissionMatrixCsv(): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, z.object({}), {}, async () =>
    csvFile('role-permissions', ['Function group', 'Employee', 'Manager', 'Admin', 'Super Admin'],
      ROLE_PERMISSION_MATRIX.map((r) => [r.group, r.EMP, r.MGR, r.ADM, r.SA])));
}

// ---------------------------------------------------------------------------
// A9 Audit & access log (SA)
// ---------------------------------------------------------------------------
export async function revealAuditEntry(input: Input): Promise<ActionResult<{ entry: AuditEntryDetail }>> {
  return runAction(SA, revealAuditEntrySchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
      const masked = await auditEntry(tx, d, false);
      if (!masked) return NOT_FOUND;
      await writeAccess(tx, {
        action: 'reveal', entityType: d.source === 'audit' ? 'audit_log' : 'access_log', entityRef: `${d.source}:${d.id}`,
        employeeIds: masked.employeeIds, fields: masked.changes.filter((c) => c.masked).map((c) => c.field),
        categories: masked.dataCategories, reason: d.reason,
      });
      return { entry: (await auditEntry(tx, d, true))! };
    }));
}

export async function exportAuditEntriesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(SA, auditListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await auditRows(tx, p, true);
      await writeAccess(tx, {
        action: 'export', entityType: 'audit_log', recordCount: rows.length,
        employeeIds: [...new Set(rows.flatMap((r) => r.employeeIds))].slice(0, 1000),
        categories: [...new Set(rows.flatMap((r) => r.dataCategories))],
        reason: `Audit export ${p.from}..${p.to}`,
      });
      return csvFile('audit-log', ['Timestamp', 'Log', 'Actor', 'User type', 'Roles at the time', 'Action', 'Entity type', 'Reference', 'Employee concerned', 'Data categories', 'Reason'],
        rows.map((r) => [csvDateTime(r.occurredAt, true), r.source === 'audit' ? 'Data change' : 'Access', r.actorName ?? r.actorLabel ?? '',
          r.actorUserType ? USER_TYPE_LABELS[r.actorUserType] : '', r.actorRoles.join(' '), AUDIT_ACTION_LABELS[r.action] ?? r.action,
          r.entityType, r.entityRef, r.employeeIds.join(' '), r.dataCategories.map((c) => DATA_CATEGORY_LABELS[c]).join('; '), r.reason]));
    }));
}

// ---------------------------------------------------------------------------
// A10 Access review (SA)
// ---------------------------------------------------------------------------
export async function markAccessReviewed(input: Input): Promise<ActionResult> {
  return runAction(SA, markAccessReviewedSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      await sql`insert into app.access_reviews as a (review_month, reviewed_by, remarks)
                values (${`${d.month}-01`}::date, app.current_app_user_id(), ${d.remarks})
                on conflict (review_month) do update set remarks = excluded.remarks, reviewed_by = excluded.reviewed_by`.execute(tx);
      return {};
    }));
}

export async function exportAccessReviewCsv(input: Input): Promise<ActionResult<CsvFile>> {
  return runAction(SA, accessReviewMonthSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await accessReview(tx, d.month);
      await writeAccess(tx, { action: 'export', entityType: 'access_review', entityRef: d.month, recordCount: r.users.length });
      const rows = [
        ...r.users.map((u) => ['User', u.displayName, USER_TYPE_LABELS[u.userType], u.roles.join(' '), USER_STATUS_LABELS[u.status], csvDateTime(u.lastLoginAt), u.daysSinceLogin, '', '', '', '']),
        ...r.externalUsers.map((u) => ['External user', u.displayName, u.serviceProvider, '', '', '', '', csvDate(u.accessEndDate), u.recordsOpened, u.sensitiveViews, u.exports]),
        ...r.flags.map((f) => ['Flag', f.actorName, f.kind, '', '', csvDateTime(f.occurredAt), '', '', '', '', f.description]),
      ];
      return csvFile(`access-review-${d.month}`, ['Section', 'User', 'Type / provider', 'Roles', 'Status', 'Last login / when', 'Days since login', 'Access end', 'Records opened', 'Sensitive views', 'Exports / detail'], rows);
    }));
}

// ---------------------------------------------------------------------------
// A11 Company privacy notice
// ---------------------------------------------------------------------------
export async function requestPrivacyNoticeUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return runAction(ADMIN, requestPrivacyNoticeUploadSchema, input, async (d, { ctx, accessToken }) => {
    const r = await requestUpload(ctx, accessToken, {
      subject: 'privacy_notice', ownerEmployeeId: null, scope: '', originalName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
    });
    return { fileId: r.fileId, bucket: r.bucket, path: r.path, signedUrl: r.signedUrl, token: r.token };
  });
}

export async function confirmPrivacyNoticeUpload(input: Input): Promise<ActionResult<{ fileId: string }>> {
  return runAction(ADMIN, z.object({ fileId: z.uuid('Invalid reference.') }), input, async (d, { ctx, accessToken }) => {
    await confirmUpload(ctx, accessToken, d.fileId);
    return { fileId: d.fileId };
  });
}

export async function publishPrivacyNotice(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, publishPrivacyNoticeSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`select app.publish_privacy_notice(${d.title}, ${d.bodyText}, ${d.fileId}::uuid, ${d.effectiveDate}::date) as id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function getPrivacyNoticeFileUrl(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(ANY, z.object({ noticeId: z.uuid('Invalid reference.') }), input, async (d, { ctx, accessToken }) => {
    const fileId = await withUserTx(ctx, async (tx) =>
      (await sql<{ file_id: string | null }>`select file_id from app.privacy_notices where id = ${d.noticeId}::uuid`.execute(tx)).rows[0]?.file_id ?? null);
    if (!fileId) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, fileId, { purpose: 'view' });
  });
}
