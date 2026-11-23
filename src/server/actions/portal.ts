'use server';

// M4 portal Server Actions (W2-006). Contract: src/server/contracts/portal.ts (function register).
// Every action: requireUser([...]) → zod → withUserTx (RLS: own rows only) → audit / access log → ActionResult.
// Delegation (G6) lives in ./approvals; the privacy notice (G7) in ./users.

import { z } from 'zod';
import { sql, withJobTx, withUserTx, type Tx } from '../db';
import { writeAccess } from '../audit';
import { requestMeta } from '../auth/request-context';
import { createSupabaseAdminClient, createSupabaseServerClient, createSupabaseStatelessClient } from '../auth/supabase';
import { fail, NO_ACCESS, runAction, type Input } from '../lib/action-helpers';
import { csvDate, csvDateTime, csvFile } from '../lib/csv';
import { getDownloadUrl, storeGeneratedFile } from '../storage';
import { renderTablePdf, renderZip, ZIP_MIME } from '../lib/claims-render';
import { gatherMyData } from '../lib/my-data-gather';
import {
  buildMyDataSummary, myDataFileName, myDataJson, myDataReadme, myDataRecordCount, MY_DATA_JSON_NAME, MY_DATA_PDF_NAME, MY_DATA_README_NAME,
} from '../lib/my-data-export';
import {
  changePasswordSchema, markNotificationSchema, myDataExportIdSchema, myHolidaysParamsSchema, notificationIdSchema, notificationListParamsSchema,
  saveNotificationPreferencesSchema, HOLIDAY_TYPE_LABELS, NOTIFICATION_CATEGORY_LABELS, PASSWORD_CHANGED_MESSAGE,
  type ActionResult, type CsvFile, type MyDataExportPage, type MyDataExportRow, type NotificationPanel, type NotificationPreferences,
} from '../contracts/portal';
import {
  ANY, MY, exportRowOf, groupsFor, myDataExportsTx, myEmployee, myExportRows, myHolidaysTx, notificationPanelTx, notificationRows,
  preferencesTx, safeHref, unreadCount,
} from '../queries/portal';
import { todayMyt } from '../queries/leave';

const NOT_FOUND = { ok: false as const, error: NO_ACCESS };
const EMPTY = z.object({}).passthrough();
const LOCKED = 'Too many unsuccessful attempts. Your account is locked for a while — try again later or contact your administrator.';
const RATE_LIMITED = 'Too many attempts. Please wait a few minutes and try again.';
const WRONG_CURRENT = 'Current password is incorrect.';
const MSGS = {
  'PRET-EXPORT-BUSY': 'A file is already being prepared. Please wait.',
  'PRET-EXPORT-LIMIT': 'You can generate up to 3 files a day. Try again tomorrow.',
  'PRET-NTF-MANDATORY': 'This notification is required and cannot be switched off.',
};

// ===========================================================================
// P11 Public holidays
// ===========================================================================
export async function exportMyHolidaysCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(MY, myHolidaysParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const page = await myHolidaysTx(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'my_public_holidays', recordCount: page.page.rows.length });
    return csvFile(`public-holidays-${page.year}`, ['Date', 'Day', 'Name', 'Type', 'Half day'],
      page.page.rows.map((r) => [csvDate(r.date), r.day, r.name, HOLIDAY_TYPE_LABELS[r.type], r.isHalfDay]));
  }));
}

// ===========================================================================
// P20 Download my data — synchronous (Vercel Hobby-safe, a few hundred KB at most)
//   1. app.start_my_data_export(): own record only, one at a time, ≤ 3/day — writes audit.access_log (committed first)
//   2. gather own rows (RLS) and decrypt own identifiers · 3. render JSON + PDF → zip · 4. store privately (bucket
//      "generated", owner = the employee) · 5. app.finish_my_data_export(): export_files row, Ready for 7 days.
//   Failure at any step → app.fail_my_data_export (status Failed, nothing downloadable).
// ===========================================================================
export async function generateMyDataExport(): Promise<ActionResult<{ export: MyDataExportRow }>> {
  return runAction(MY, EMPTY, {}, async (_d, { ctx, accessToken }) => {
    const start = await withUserTx({ ...ctx, reason: 'Download my data (F-PRT-16)' }, async (tx) => {
      const me = await myEmployee(tx);
      if (!me) return null;
      const id = (await sql<{ id: string }>`select app.start_my_data_export() as id`.execute(tx)).rows[0]!.id;
      return { id, me };
    });
    if (!start) return NOT_FOUND;
    try {
      const built = await withUserTx(ctx, async (tx) => {
        const company = (await sql<{ n: string | null }>`select legal_name as n from app.company_profile where id = 1`.execute(tx)).rows[0]?.n ?? 'Interact Technology Sdn Bhd';
        const doc = await gatherMyData(tx, start.me, company);
        const today = await todayMyt(tx);
        return { doc, today };
      });
      const { doc } = built;
      const summary = buildMyDataSummary(doc);
      const pdf = await renderTablePdf({ title: summary.title, header: summary.header, footer: summary.footer }, summary.sections as never);
      const zip = await renderZip([
        { name: MY_DATA_JSON_NAME, bytes: Buffer.from(myDataJson(doc), 'utf8') },
        { name: MY_DATA_PDF_NAME, bytes: pdf },
        { name: MY_DATA_README_NAME, bytes: Buffer.from(myDataReadme(doc), 'utf8') },
      ]);
      const fileName = myDataFileName(String(doc.employee.employee_no ?? 'employee'), doc.generatedAt);
      const [y, m, dd] = built.today.split('-').map(Number) as [number, number, number];
      const purgeAfter = new Date(Date.UTC(y, m - 1, dd + 8)).toISOString().slice(0, 10);
      const stored = await storeGeneratedFile(ctx, accessToken, {
        scope: `mydata/${start.me}`, fileName, mimeType: ZIP_MIME, bytes: zip, dataCategory: 'identity',
        ownerEmployeeId: start.me, retentionDeleteAfter: purgeAfter,
      });
      const row = await withUserTx(ctx, async (tx) => {
        await sql`select app.finish_my_data_export(${start.id}::uuid, ${stored.fileId}::uuid, ${myDataRecordCount(doc)}::int, ${stored.sha256})`.execute(tx);
        return (await myExportRows(tx, start.id))[0];
      });
      if (!row) return NOT_FOUND;
      return { export: exportRowOf(row) };
    } catch (e) {
      console.error('[pret] my-data export failed', (e as { message?: string })?.message?.slice(0, 200) ?? '');
      try {
        await withUserTx(ctx, async (tx) => {
          await sql`select app.fail_my_data_export(${start.id}::uuid, 'The file could not be prepared. Please try again.')`.execute(tx);
        });
      } catch { /* the stale run is closed after 15 minutes */ }
      return fail('The file could not be prepared. Please try again.');
    }
  }, undefined, MSGS);
}

export async function downloadMyDataExport(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(MY, myDataExportIdSchema, input, async (d, { ctx, accessToken }) => {
    const row = await withUserTx(ctx, async (tx) => (await myExportRows(tx, d.id))[0] ?? null);
    if (!row) return NOT_FOUND;
    const view = exportRowOf(row);
    if (view.status === 'expired') return fail('This file has expired. Generate a new one.');
    if (view.status !== 'ready' || !row.file_id) return fail('This file is not ready.');
    // the grant insert is checked by app.can_read_file (requester only, not expired) and access-logged by the DB trigger
    return getDownloadUrl({ ...ctx, reason: 'Download my data (F-PRT-16)' }, accessToken, row.file_id, { purpose: 'download', reason: 'Download my data (F-PRT-16)' });
  });
}

export async function fetchMyDataExports(): Promise<ActionResult<{ page: MyDataExportPage }>> {
  return runAction(MY, EMPTY, {}, async (_d, { ctx }) => withUserTx(ctx, async (tx) => ({ page: await myDataExportsTx(tx) })));
}

// ===========================================================================
// G5 Notifications — own rows only (RLS recipient = me; read time set by the DB guard)
// ===========================================================================
export async function fetchNotificationPanel(): Promise<ActionResult<{ panel: NotificationPanel }>> {
  return runAction(ANY, EMPTY, {}, async (_d, { ctx }) => withUserTx(ctx, async (tx) => ({ panel: await notificationPanelTx(tx) })));
}

export async function markNotification(input: Input): Promise<ActionResult<{ unreadCount: number }>> {
  return runAction(ANY, markNotificationSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = await sql`update app.notifications set read_at = ${d.read ? sql`now()` : sql`null`}
                         where id = ${d.id}::uuid and recipient_user_id = app.current_app_user_id()`.execute(tx);
    if (!Number(r.numAffectedRows ?? 0)) return NOT_FOUND;
    return { unreadCount: await unreadCount(tx) };
  }));
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ marked: number; unreadCount: 0 }>> {
  return runAction(ANY, EMPTY, {}, async (_d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = await sql`update app.notifications set read_at = now()
                         where recipient_user_id = app.current_app_user_id() and read_at is null`.execute(tx);
    return { marked: Number(r.numAffectedRows ?? 0), unreadCount: 0 as const };
  }));
}

export async function openNotification(input: Input): Promise<ActionResult<{ href: string | null; unreadCount: number }>> {
  return runAction(ANY, notificationIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = await sql<{ link_path: string | null }>`update app.notifications set read_at = coalesce(read_at, now())
        where id = ${d.id}::uuid and recipient_user_id = app.current_app_user_id() returning link_path`.execute(tx);
    if (!r.rows.length) return NOT_FOUND;
    return { href: safeHref(r.rows[0]!.link_path), unreadCount: await unreadCount(tx) };
  }));
}

export async function exportNotificationsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, notificationListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await notificationRows(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'my_notifications', recordCount: rows.length });
    return csvFile('notifications', ['Received', 'Category', 'Title', 'Summary', 'Status'],
      rows.map((r) => [csvDateTime(r.createdAt), NOTIFICATION_CATEGORY_LABELS[r.category], r.title, r.summary, r.unread ? 'Unread' : 'Read']));
  }));
}

// ===========================================================================
// G6 Notification preferences (F-NTF-06, BR-NTF-04)
// ===========================================================================
export async function saveNotificationPreferences(input: Input): Promise<ActionResult<{ preferences: NotificationPreferences }>> {
  return runAction(ANY, saveNotificationPreferencesSchema, input, async (d, { ctx, user }) => withUserTx(ctx, async (tx) => {
    const allowed = new Map(groupsFor(user).map((g) => [g.key, g]));
    const errors: Record<string, string> = {};
    for (const g of d.groups) {
      const def = allowed.get(g.key);
      if (!def) errors[`groups.${g.key}`] = 'Unknown notification group.';
      else if (def.mandatory && !g.emailEnabled) errors[`groups.${g.key}`] = 'Required — this email cannot be switched off.';
    }
    if (Object.keys(errors).length) return fail('Please correct the highlighted settings.', errors);
    for (const g of d.groups) {
      const def = allowed.get(g.key)!;
      if (def.mandatory) continue;
      await sql`insert into app.notification_preferences (user_id, event_code, email_enabled)
                select app.current_app_user_id(), c, ${g.emailEnabled} from unnest(${def.eventCodes}::text[]) as c
                on conflict (user_id, event_code) do update set email_enabled = excluded.email_enabled
                where app.notification_preferences.email_enabled is distinct from excluded.email_enabled`.execute(tx);
    }
    return { preferences: await preferencesTx(tx, user) };
  }), undefined, MSGS);
}

// ===========================================================================
// G6 Change password (F-PRT-14, BR-ADM-07, ADR-0014) — re-authenticate with the current password through Supabase Auth
// (throw-away client: the request's cookies are untouched); a wrong current password counts toward the lockout like a
// sign-in failure; success signs out every other session and writes login_events 'password_changed'.
// Passwords are never logged, stored or returned.
// ===========================================================================
async function rateLimited(tx: Tx, key: string, windowSeconds: number, max: number): Promise<boolean> {
  const r = await sql<{ ok: boolean }>`select private.rate_limit_hit(${key}, ${windowSeconds}::int, ${max}::int) as ok`.execute(tx);
  return r.rows[0]?.ok === false;
}

export async function changePassword(input: Input): Promise<ActionResult<{ message: string }>> {
  return runAction(ANY, changePasswordSchema, input, async (d, { ctx, user }) => {
    const meta = await requestMeta();
    const sub = ctx.claims.sub;
    const sid = typeof ctx.claims.session_id === 'string' ? ctx.claims.session_id : '';
    const pre = await withJobTx('auth-password', async (tx) => {
      if (await rateLimited(tx, `pwchange:${user.id}`, 900, 5)) return 'rate' as const;
      const r = await sql<{ login_email: string; failed_login_count: number; lockout_threshold: number; lockout_minutes: number; locked: boolean }>`
        select u.login_email::text as login_email, u.failed_login_count,
               coalesce(s.lockout_threshold, 5) as lockout_threshold, coalesce(s.lockout_minutes, 30) as lockout_minutes,
               coalesce(u.locked_until > now(), false) as locked
          from app.app_users u left join app.security_settings s on s.id = 1
         where u.id = ${user.id}::uuid and u.auth_user_id = ${sub}::uuid and u.status = 'active'`.execute(tx);
      return r.rows[0] ?? null;
    });
    if (pre === 'rate') return fail(RATE_LIMITED);
    if (!pre) return fail(NO_ACCESS);
    if (pre.locked) return fail(LOCKED);

    // 1. re-authenticate (throw-away session)
    const temp = createSupabaseStatelessClient();
    const auth = await temp.auth.signInWithPassword({ email: pre.login_email, password: d.currentPassword });
    if (auth.error || !auth.data.session || auth.data.user?.id !== sub) {
      if (auth.data.session) await temp.auth.signOut({ scope: 'local' }).catch(() => undefined);
      const lock = await withJobTx('auth-password', async (tx) => {
        const count = pre.failed_login_count + 1;
        const nowLocked = count >= pre.lockout_threshold;
        await sql`update app.app_users set failed_login_count = ${nowLocked ? 0 : count},
                     locked_until = ${nowLocked ? sql`now() + make_interval(mins => ${pre.lockout_minutes}::int)` : sql`locked_until`}
                   where id = ${user.id}::uuid`.execute(tx);
        await sql`insert into app.login_events (login_email, user_id, outcome, ip, user_agent, detail)
                  values (${pre.login_email}, ${user.id}::uuid, ${nowLocked ? 'locked' : 'failure'}::app.login_outcome, ${meta.ip}::inet, ${meta.userAgent},
                          'password change: current password incorrect')`.execute(tx);
        if (nowLocked) {
          await sql`select app.notify(${user.id}::uuid, 'N-52', 'Your PRET account was locked after repeated sign-in failures',
                                      null, '/login', false, 'account_locked', '{}'::jsonb)`.execute(tx);
          await sql`select app.notify(r.user_id, 'N-52', 'A PRET account was locked after repeated sign-in failures',
                                      null, '/admin/users', false, 'account_locked_admin', jsonb_build_object('user_id', ${user.id}::text))
                      from app.user_roles r join app.app_users u on u.id = r.user_id
                     where r.role = 'SA' and r.revoked_at is null and u.status = 'active'`.execute(tx);
          await sql`update app.app_sessions set ended_at = now(), end_reason = 'logout' where user_id = ${user.id}::uuid and ended_at is null`.execute(tx);
        }
        return nowLocked;
      });
      if (lock) {
        const supabase = await createSupabaseServerClient();
        await supabase.auth.signOut({ scope: 'global' }).catch(() => undefined);
        return fail(LOCKED);
      }
      return fail(WRONG_CURRENT, { currentPassword: WRONG_CURRENT });
    }

    // 2. set the new password on the user's own session (aal2 for privileged users); admin API only as a fallback
    const weak = 'This password is too weak, has appeared in a data breach, or matches your previous one. Choose another.';
    const supabase = await createSupabaseServerClient();
    let upd = await supabase.auth.updateUser({ password: d.newPassword });
    if (upd.error && !/weak|pwned|breach|same|different|should be/i.test(upd.error.message)) {
      const admin = createSupabaseAdminClient();
      if (admin) {
        const r = await admin.auth.admin.updateUserById(sub, { password: d.newPassword });
        upd = { data: { user: r.data.user }, error: r.error } as typeof upd;
      }
    }
    await temp.auth.signOut({ scope: 'local' }).catch(() => undefined);
    if (upd.error) {
      const m = /password|weak|pwned|breach|same|different/i.test(upd.error.message) ? weak : 'Something went wrong. Please try again.';
      return m === weak ? fail(m, { newPassword: m }) : fail(m);
    }

    // 3. other sessions out + security event
    await supabase.auth.signOut({ scope: 'others' }).catch(() => undefined);
    await withJobTx('auth-password', async (tx) => {
      await sql`update app.app_sessions s set ended_at = now(), end_reason = 'password_change'
                 where s.user_id = ${user.id}::uuid and s.ended_at is null and s.session_id::text is distinct from ${sid}`.execute(tx);
      await sql`update app.app_users set failed_login_count = 0 where id = ${user.id}::uuid`.execute(tx);
      await sql`insert into app.login_events (login_email, user_id, outcome, ip, user_agent, detail)
                values (${pre.login_email}, ${user.id}::uuid, 'password_changed'::app.login_outcome, ${meta.ip}::inet, ${meta.userAgent},
                        'password changed in account settings; other sessions signed out')`.execute(tx);
    });
    return { message: PASSWORD_CHANGED_MESSAGE };
  });
}
