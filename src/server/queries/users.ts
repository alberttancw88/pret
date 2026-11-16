import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { logRecordOpen } from '../audit';
import { authorize, hasRole, iso, likeTerm, resolveNames, stamps } from '../lib/action-helpers';
import {
  loginHistoryParamsSchema, userListParamsSchema, ROLE_DESCRIPTIONS, ROLE_PERMISSION_LEGEND, ROLE_PERMISSION_MATRIX,
  type InvitableEmployees, type LoginEventRow, type LoginHistoryParams, type LoginOutcome, type Paged, type PrivacyNotice,
  type PrivilegedRole, type RolePermissionRow, type UserDetail, type UserInvitationInfo, type UserListParams, type UserRow,
  type UserStatus, type UserType,
} from '../contracts/users';
import { EXPORT_LIMIT, parseParams } from './org';

// M6 Users & access queries (W2-002). ADM scope (employee users without privileged roles) is
// enforced by RLS on app.app_users; SA sees everyone. The PRET System actor is never listed.

export const USER_ADMIN: Role[] = ['ADM', 'SA'];
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001';

type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);

type UserDb = {
  id: string; display_name: string; login_email: string; user_type: UserType; employee_id: string | null; roles: PrivilegedRole[];
  status: UserStatus; raw_status: UserStatus; last_login_at: Date | null; mfa_enrolled: boolean; access_start_date: string;
  access_end_date: string | null; service_provider: string | null; auth_user_id: string | null; failed_login_count: number;
  locked_until: Date | null; disabled_reason: string | null; invited_at: Date | null; invited_by: string | null;
  created_at: Date; created_by: string | null; updated_at: Date; updated_by: string | null;
};
const USER_FROM = sql`(
  select u.*, u.status::text as raw_status,
         array(select r.role::text from app.user_roles r where r.user_id = u.id and r.revoked_at is null order by r.role desc) as roles,
         case when u.status in ('active','locked') and u.locked_until > now() then 'locked'
              when u.status = 'locked' then 'active'
              when u.status = 'active' and u.access_end_date < app.today_myt() then 'expired'
              else u.status::text end as eff_status
    from app.app_users u where u.id <> ${SYSTEM_ACTOR_ID}::uuid) x`;
const USER_SORT: Record<string, string> = {
  displayName: 'x.display_name', loginEmail: 'x.login_email', userType: 'x.user_type', status: 'x.eff_status',
  lastLogin: 'x.last_login_at', accessEnd: 'x.access_end_date',
};

function mapUser(r: UserDb & { eff_status: UserStatus }, reportees: Map<string, number>): UserRow {
  return {
    id: r.id, displayName: r.display_name, loginEmail: r.login_email, userType: r.user_type, employeeId: r.employee_id,
    employeeNo: null, employeeName: null, roles: r.roles,
    directReportees: r.employee_id ? reportees.get(r.employee_id) ?? 0 : 0,
    status: r.eff_status, lastLoginAt: iso(r.last_login_at), mfaEnrolled: r.mfa_enrolled,
    accessStartDate: r.access_start_date, accessEndDate: r.access_end_date, serviceProvider: r.service_provider,
  };
}

async function reporteeCounts(tx: Tx, employeeIds: (string | null)[]): Promise<Map<string, number>> {
  const ids = employeeIds.filter((v): v is string => !!v);
  const m = new Map<string, number>();
  if (!ids.length) return m;
  const r = await sql<{ employee_id: string; n: number }>`select employee_id, n from app.direct_reportee_counts(${ids}::uuid[])`.execute(tx);
  for (const x of r.rows) m.set(x.employee_id, x.n);
  return m;
}

export async function userRows(tx: Tx, params: UserListParams, all = false): Promise<Paged<UserRow>> {
  const p = parseParams(userListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(q ? [sql`(x.display_name ilike ${q} or x.login_email::text ilike ${q})`] : []),
    ...(p.userType ? [sql`x.user_type = ${p.userType}::app.user_type`] : []),
    ...(p.role === 'none' ? [sql`cardinality(x.roles) = 0`] : p.role ? [sql`${p.role} = any(x.roles)`] : []),
    ...(p.status?.length ? [sql`x.eff_status = any(${p.status}::text[])`] : []),
    ...(p.lastLoginFrom ? [sql`(x.last_login_at at time zone 'Asia/Kuala_Lumpur')::date >= ${p.lastLoginFrom}::date`] : []),
    ...(p.lastLoginTo ? [sql`(x.last_login_at at time zone 'Asia/Kuala_Lumpur')::date <= ${p.lastLoginTo}::date`] : []),
    ...(p.mfa === 'enrolled' ? [sql`x.mfa_enrolled`] : p.mfa === 'not_enrolled' ? [sql`not x.mfa_enrolled`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize;
  const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<UserDb & { eff_status: UserStatus }>`select x.* from ${USER_FROM} where ${where}
     order by ${sql.raw(USER_SORT[p.sort] ?? 'x.display_name')} ${sql.raw(p.dir === 'desc' ? 'desc' : 'asc')} nulls last, x.display_name
     limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${USER_FROM} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const rc = await reporteeCounts(tx, rows.rows.map((r) => r.employee_id));
  return { rows: rows.rows.map((r) => mapUser(r, rc)), total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize };
}

export async function listUsers(params: UserListParams): Promise<Paged<UserRow>> {
  const { ctx } = await authorize(USER_ADMIN);
  return withUserTx(ctx, (tx) => userRows(tx, params));
}

export async function getUser(id: string): Promise<UserDetail | null> {
  const { user, ctx } = await authorize(USER_ADMIN);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return withUserTx(ctx, async (tx) => {
    const r = (await sql<UserDb & { eff_status: UserStatus }>`select x.* from ${USER_FROM} where x.id = ${id}::uuid`.execute(tx)).rows[0];
    if (!r) return null;
    await logRecordOpen(tx, user, 'app_users', r.id, r.employee_id);
    const inv = (await sql<{ created_at: Date; scheduled_send_at: Date | null; sent_at: Date | null; expires_at: Date; accepted_at: Date | null; revoked_at: Date | null }>`
      select created_at, scheduled_send_at, sent_at, expires_at, accepted_at, revoked_at
        from app.user_invitations where user_id = ${id}::uuid order by created_at desc limit 1`.execute(tx)).rows[0];
    const isSa = hasRole(user, 'SA');
    const history = isSa
      ? (await sql<{ role: PrivilegedRole; granted_at: Date; granted_by: string; revoked_at: Date | null; revoked_by: string | null }>`
          select role::text as role, granted_at, granted_by, revoked_at, revoked_by from app.user_roles
           where user_id = ${id}::uuid order by granted_at desc`.execute(tx)).rows
      : [];
    const names = await resolveNames(tx, [r.created_by, r.updated_by, r.invited_by, ...history.flatMap((h) => [h.granted_by, h.revoked_by])]);
    const rc = await reporteeCounts(tx, [r.employee_id]);
    let invitation: UserInvitationInfo | null = null;
    if (inv) {
      const now = Date.now();
      const status: UserInvitationInfo['status'] = inv.accepted_at ? 'accepted' : inv.revoked_at ? 'revoked'
        : inv.expires_at.getTime() < now ? 'expired' : inv.scheduled_send_at && inv.scheduled_send_at.getTime() > now ? 'scheduled' : 'pending';
      invitation = { status, createdAt: iso(inv.created_at)!, scheduledSendAt: iso(inv.scheduled_send_at), sentAt: iso(inv.sent_at), expiresAt: iso(inv.expires_at)!, acceptedAt: iso(inv.accepted_at) };
    }
    const isSelf = r.id === user.id;
    const privileged = r.roles.length > 0;
    const manageable = !isSelf && (isSa || (hasRole(user, 'ADM') && r.user_type === 'employee' && !privileged));
    const locked = r.eff_status === 'locked' || r.raw_status === 'locked';
    const sysName = (id: string | null) => (id === SYSTEM_ACTOR_ID ? 'PRET System' : id ? names.get(id) ?? null : null);
    return {
      ...mapUser(r, rc),
      failedLoginCount: r.failed_login_count, lockedUntil: iso(r.locked_until), disabledReason: r.disabled_reason,
      invitedAt: iso(r.invited_at), invitedByName: sysName(r.invited_by), invitation,
      roleHistory: history.map((h) => ({ role: h.role, grantedAt: iso(h.granted_at)!, grantedByName: sysName(h.granted_by), revokedAt: iso(h.revoked_at), revokedByName: sysName(h.revoked_by) })),
      isSelf,
      can: {
        editAccount: isSa && !isSelf,
        editRoles: isSa && !isSelf && !['disabled', 'expired'].includes(r.raw_status),
        editAccessWindow: isSa && !isSelf,
        disable: manageable && r.raw_status !== 'disabled',
        enable: manageable && r.raw_status === 'disabled',
        unlock: manageable && locked,
        sendPasswordReset: manageable && !!r.auth_user_id && r.eff_status === 'active',
        resetMfa: isSa && !isSelf && !!r.auth_user_id && r.mfa_enrolled,
        resendInvite: manageable && r.raw_status === 'invited' && !r.auth_user_id,
        viewLoginHistory: isSa,
      },
      ...stamps(r, names),
    };
  });
}

export async function loginHistoryRows(tx: Tx, params: LoginHistoryParams, all = false): Promise<Paged<LoginEventRow>> {
  const p = parseParams(loginHistoryParamsSchema, params);
  const where = and([
    sql`e.user_id = ${p.userId}::uuid`,
    ...(p.outcome?.length ? [sql`e.outcome::text = any(${p.outcome}::text[])`] : []),
    ...(p.from ? [sql`e.occurred_at >= (${p.from}::date::timestamp at time zone 'Asia/Kuala_Lumpur')`] : []),
    ...(p.to ? [sql`e.occurred_at < ((${p.to}::date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')`] : []),
  ]);
  const limit = all ? EXPORT_LIMIT : p.pageSize;
  const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<{ id: string; occurred_at: Date; outcome: LoginOutcome; ip: string | null; user_agent: string | null; detail: string | null }>`
    select e.id::text, e.occurred_at, e.outcome::text as outcome, host(e.ip) as ip, e.user_agent, e.detail
      from app.login_events e where ${where}
     order by e.occurred_at ${sql.raw(p.dir === 'asc' ? 'asc' : 'desc')} limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.login_events e where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return {
    rows: rows.rows.map((r) => ({ id: r.id, occurredAt: iso(r.occurred_at)!, outcome: r.outcome, ip: r.ip, userAgent: r.user_agent, detail: r.detail })),
    total, page: all ? 1 : p.page, pageSize: all ? EXPORT_LIMIT : p.pageSize,
  };
}

export async function listUserLoginHistory(params: LoginHistoryParams): Promise<Paged<LoginEventRow>> {
  const { ctx } = await authorize(['SA']);
  return withUserTx(ctx, (tx) => loginHistoryRows(tx, params));
}

export async function listInvitableEmployees(): Promise<InvitableEmployees> {
  await authorize(USER_ADMIN);
  return {
    available: false,
    message: 'Employee users can be invited once employee records are available (W2-003). External administrators can be invited now.',
    rows: [],
  };
}

export async function getRolePermissionMatrix(): Promise<{ roles: typeof ROLE_DESCRIPTIONS; rows: RolePermissionRow[]; legend: string }> {
  await authorize(USER_ADMIN);
  return { roles: ROLE_DESCRIPTIONS, rows: ROLE_PERMISSION_MATRIX, legend: ROLE_PERMISSION_LEGEND };
}

// ---------------------------------------------------------------------------
// A11 Privacy notice (S-GL-09: current + history for every user)
// ---------------------------------------------------------------------------
type NoticeDb = {
  id: string; title: string; body_text: string | null; file_id: string | null; file_name: string | null; effective_date: string;
  is_current: boolean; published_at: Date; published_by: string; superseded_at: Date | null;
};
async function notices(tx: Tx, currentOnly: boolean): Promise<PrivacyNotice[]> {
  const r = await sql<NoticeDb>`
    select n.id, n.title, n.body_text, n.file_id, f.original_name as file_name, n.effective_date, n.is_current,
           n.published_at, n.published_by, n.superseded_at
      from app.privacy_notices n left join app.files f on f.id = n.file_id
     where ${currentOnly ? sql`n.is_current` : sql`true`}
     order by n.published_at desc`.execute(tx);
  const names = await resolveNames(tx, r.rows.map((x) => x.published_by));
  return r.rows.map((x) => ({
    id: x.id, title: x.title, bodyText: x.body_text, fileId: x.file_id, fileName: x.file_name, effectiveDate: x.effective_date,
    isCurrent: x.is_current, publishedAt: iso(x.published_at)!, publishedByName: names.get(x.published_by) ?? null, supersededAt: iso(x.superseded_at),
  }));
}

export async function getCurrentPrivacyNotice(): Promise<PrivacyNotice | null> {
  const { ctx } = await authorize(['EMP', 'MGR', 'ADM', 'SA']);
  return withUserTx(ctx, async (tx) => (await notices(tx, true))[0] ?? null);
}

export async function listPrivacyNoticeHistory(): Promise<PrivacyNotice[]> {
  const { ctx } = await authorize(['EMP', 'MGR', 'ADM', 'SA']);
  return withUserTx(ctx, (tx) => notices(tx, false));
}
