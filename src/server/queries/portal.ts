import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import type { CurrentUser, Role } from '../auth/current-user';
import { getUserContext } from '../auth/current-user';
import { authorize, iso, likeTerm } from '../lib/action-helpers';
import { parseParams, EXPORT_LIMIT } from './org';
import { todayMyt } from './leave';
import {
  MY_DATA_EXPORT_AVAILABLE_DAYS, MY_DATA_EXPORT_DAILY_LIMIT, MY_DATA_EXPORT_INTRO, MY_DATA_EXPORT_SECTIONS, MY_STATE_LABELS,
  NOTIFICATION_PANEL_SIZE, NOTIFICATION_PREFERENCE_GROUPS, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PASSWORD_RULES,
  myHolidaysParamsSchema, notificationCategory, notificationListParamsSchema,
  type AccountSettings, type AccountTab, type DataExportStatus, type MyDataExportPage, type MyDataExportRow, type MyHolidayRow,
  type MyHolidaysPage, type MyHolidaysParams, type MyState, type NotificationCategory, type NotificationListParams,
  type NotificationPanel, type NotificationPreferenceGroupDef, type NotificationPreferences, type NotificationRow, type Paged,
  type PreferenceAudience, type ShellStatus, type HolidayType,
} from '../contracts/portal';

// M4 portal queries (W2-006). Contract: src/server/contracts/portal.ts (function register).
// Every query: requireUser([...]) → withUserTx (RLS: own notifications / preferences / export jobs; published holidays).

export const ANY: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
/** "My" screens: EMP = has an employee record (app.current_role_codes) — never External ADM. */
export const MY: Role[] = ['EMP'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (d: string) => DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]!;

export async function myEmployee(tx: Tx): Promise<string | null> {
  return (await sql<{ id: string | null }>`select app.current_employee_id() as id`.execute(tx)).rows[0]?.id ?? null;
}

// ===========================================================================
// P11 Public holidays
// ===========================================================================
export async function myHolidaysTx(tx: Tx, params: MyHolidaysParams, all = false): Promise<MyHolidaysPage> {
  const p = parseParams(myHolidaysParamsSchema, params);
  const today = await todayMyt(tx);
  const year = p.year ?? Number(today.slice(0, 4));
  const me = await myEmployee(tx);
  const empty = (published: boolean, state: MyState | null, years: number[]): MyHolidaysPage => ({
    hasEmployeeRecord: !!me, state, stateLabel: state ? MY_STATE_LABELS[state] : null, year, published,
    unpublishedNote: published ? null : `The ${year} calendar has not been published yet.`, years,
    page: { rows: [], total: 0, page: 1, pageSize: p.pageSize }, calendar: [],
  });
  if (!me) return empty(false, null, [year]);
  // Work-location state, or the F20 PH-state override (same rule as app.employee_calendar); pattern for replacement holidays
  const e = (await sql<{ state: MyState; pattern_id: string }>`
      select coalesce(h.ph_state_override, l.state, e.work_state)::text as state, e.working_pattern_id as pattern_id
        from app.employees e left join app.work_locations l on l.id = e.work_location_id
        left join app.employee_hr_private h on h.employee_id = e.id
       where e.id = ${me}::uuid`.execute(tx)).rows[0];
  if (!e) return empty(false, null, [year]);
  const years = (await sql<{ y: number }>`select distinct y.year::int as y from app.holiday_calendar_years y where y.status = 'published' order by 1 desc`.execute(tx)).rows.map((r) => r.y);
  const yearList = [...new Set([...years, Number(today.slice(0, 4)), year])].sort((a, b) => b - a);
  const published = (await sql<{ p: boolean }>`select app.holiday_year_published(${year}::int) as p`.execute(tx)).rows[0]?.p ?? false;
  if (!published) return empty(false, e.state, yearList);

  const rows = await sql<R>`
    select h.id, 'holiday' as kind, h.holiday_date::text as date, h.name, h.holiday_type::text as type, h.is_half_day as half,
           null::text as replaces_name, null::text as replaces_date
      from app.public_holidays h join app.public_holiday_states s on s.holiday_id = h.id and s.state = ${e.state}::app.my_state
     where h.year = ${year} and h.is_active and h.is_observed
    union all
    select r.id, 'replacement', r.replacement_date::text, 'Replacement holiday (' || h.name || ')', 'replacement', false,
           h.name, h.holiday_date::text
      from app.replacement_holidays r join app.public_holidays h on h.id = r.source_holiday_id
     where r.state = ${e.state}::app.my_state and r.pattern_id = ${e.pattern_id}::uuid and r.is_active
       and extract(year from r.replacement_date)::int = ${year}`.execute(tx);
  const q = p.q?.toLowerCase();
  const items: MyHolidayRow[] = rows.rows
    .map((r) => ({ id: r.id, kind: r.kind, date: r.date, day: dayName(r.date), name: r.name, type: r.type as HolidayType, isHalfDay: !!r.half,
      replacesName: r.replaces_name, replacesDate: r.replaces_date, isPast: r.date < today }))
    .filter((r) => (!q || r.name.toLowerCase().includes(q)) && (!p.types?.length || p.types.includes(r.type)));
  const dir = p.dir === 'desc' ? -1 : 1;
  items.sort((a, b) => dir * (p.sort === 'name' ? a.name.localeCompare(b.name) || a.date.localeCompare(b.date) : a.date.localeCompare(b.date) || a.name.localeCompare(b.name)));
  const size = all ? EXPORT_LIMIT : p.pageSize;
  const page = all ? 1 : p.page;
  return {
    hasEmployeeRecord: true, state: e.state, stateLabel: MY_STATE_LABELS[e.state], year, published: true, unpublishedNote: null, years: yearList,
    page: { rows: items.slice((page - 1) * size, page * size), total: items.length, page, pageSize: size },
    calendar: [...items].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
export async function getMyHolidays(params: MyHolidaysParams): Promise<MyHolidaysPage> {
  const { ctx } = await authorize(MY);
  return withUserTx(ctx, (tx) => myHolidaysTx(tx, params));
}

// ===========================================================================
// P20 Download my data
// ===========================================================================
function exportStatus(r: R, now: Date): DataExportStatus {
  if (r.status === 'running') return 'preparing';
  if (r.status === 'failed') return 'failed';
  return r.expires_at && new Date(r.expires_at) > now ? 'ready' : 'expired';
}
export function exportRowOf(r: R, now = new Date()): MyDataExportRow {
  const status = exportStatus(r, now);
  return {
    id: r.id, requestedAt: iso(r.created_at)!, status, availableUntil: status === 'ready' || status === 'expired' ? iso(r.expires_at) : null,
    fileName: r.file_name ?? null, sizeBytes: r.size_bytes ?? null, canDownload: status === 'ready',
    error: status === 'failed' ? (r.error ?? 'The file could not be prepared. Please try again.') : null,
  };
}
export async function myExportRows(tx: Tx, id?: string): Promise<R[]> {
  return (await sql<R>`
    select j.id, j.status::text as status, j.created_at, j.expires_at, j.error, f.original_name as file_name, f.size_bytes, x.file_id
      from app.export_jobs j
      left join app.export_files x on x.id = j.result_export_file_id
      left join app.files f on f.id = x.file_id
     where j.requested_by = app.current_app_user_id() and j.kind = 'my_data_export'
       ${id ? sql`and j.id = ${id}::uuid` : sql``}
     order by j.created_at desc limit 20`.execute(tx)).rows;
}
export async function myDataExportsTx(tx: Tx): Promise<MyDataExportPage> {
  const me = await myEmployee(tx);
  const now = new Date();
  const rows = me ? (await myExportRows(tx)).map((r) => exportRowOf(r, now)) : [];
  const today = await todayMyt(tx);
  const todayCount = me ? (await sql<{ n: number }>`select count(*)::int as n from app.export_jobs j
      where j.requested_by = app.current_app_user_id() and j.kind = 'my_data_export'
        and (j.created_at at time zone 'Asia/Kuala_Lumpur')::date = ${today}::date`.execute(tx)).rows[0]?.n ?? 0 : 0;
  const busy = rows.some((r) => r.status === 'preparing' && Date.now() - new Date(r.requestedAt).getTime() < 15 * 60_000);
  const blocked = !me ? 'Not available without an employee record.'
    : busy ? 'A file is being prepared.'
    : todayCount >= MY_DATA_EXPORT_DAILY_LIMIT ? `You can generate up to ${MY_DATA_EXPORT_DAILY_LIMIT} files a day. Try again tomorrow.` : null;
  return {
    hasEmployeeRecord: !!me, intro: MY_DATA_EXPORT_INTRO, sections: MY_DATA_EXPORT_SECTIONS, availableDays: MY_DATA_EXPORT_AVAILABLE_DAYS,
    rows, canGenerate: blocked === null, generateBlockedReason: blocked,
  };
}
export async function getMyDataExports(): Promise<MyDataExportPage> {
  const { ctx } = await authorize(MY);
  return withUserTx(ctx, myDataExportsTx);
}

// ===========================================================================
// G5 Notifications (own rows — RLS recipient = me)
// ===========================================================================
/** In-app links are relative paths only (never another origin). */
export function safeHref(link: string | null | undefined): string | null {
  if (!link || typeof link !== 'string') return null;
  const t = link.trim();
  if (!t.startsWith('/') || t.startsWith('//') || t.includes('\\') || /[\u0000-\u001f]/.test(t)) return null;
  return t.slice(0, 500);
}
const CATEGORY_SQL: Record<NotificationCategory, Where> = {
  claims: sql`(substr(n.event_code, 3)::int between 20 and 29 or n.event_code in ('N-59','N-60'))`,
  leave: sql`(substr(n.event_code, 3)::int between 1 and 19)`,
  payroll: sql`(substr(n.event_code, 3)::int between 30 and 39)`,
  profile: sql`(substr(n.event_code, 3)::int between 40 and 49)`,
  system: sql`(substr(n.event_code, 3)::int not between 1 and 49 and n.event_code not in ('N-59','N-60'))`,
};
export function notificationRowOf(r: R): NotificationRow {
  return {
    id: r.id, eventCode: r.event_code, category: notificationCategory(r.event_code), title: r.title, summary: r.body ?? null,
    href: safeHref(r.link_path), isActionRequired: !!r.is_action_required, unread: r.read_at == null, readAt: iso(r.read_at), createdAt: iso(r.created_at)!,
  };
}
export async function unreadCount(tx: Tx): Promise<number> {
  return (await sql<{ n: number }>`select count(*)::int as n from app.notifications n
      where n.recipient_user_id = app.current_app_user_id() and n.read_at is null`.execute(tx)).rows[0]?.n ?? 0;
}
export async function notificationPanelTx(tx: Tx): Promise<NotificationPanel> {
  const r = await sql<R>`select n.* from app.notifications n where n.recipient_user_id = app.current_app_user_id()
      order by n.created_at desc limit ${NOTIFICATION_PANEL_SIZE}`.execute(tx);
  return { items: r.rows.map(notificationRowOf), unreadCount: await unreadCount(tx) };
}
export async function notificationRows(tx: Tx, params: NotificationListParams, all: boolean): Promise<Paged<NotificationRow>> {
  const p = parseParams(notificationListParamsSchema, params);
  const conds: Where[] = [sql`n.recipient_user_id = app.current_app_user_id()`];
  if (p.read === 'unread') conds.push(sql`n.read_at is null`);
  if (p.read === 'read') conds.push(sql`n.read_at is not null`);
  if (p.categories?.length) conds.push(sql`(${sql.join(p.categories.map((c) => CATEGORY_SQL[c]), sql` or `)})`);
  if (p.dateFrom) conds.push(sql`(n.created_at at time zone 'Asia/Kuala_Lumpur')::date >= ${p.dateFrom}::date`);
  if (p.dateTo) conds.push(sql`(n.created_at at time zone 'Asia/Kuala_Lumpur')::date <= ${p.dateTo}::date`);
  const q = likeTerm(p.q);
  if (q) conds.push(sql`(n.title ilike ${q} or coalesce(n.body, '') ilike ${q})`);
  const where = and(conds);
  const limit = all ? EXPORT_LIMIT : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<R>`select n.* from app.notifications n where ${where}
      order by n.created_at ${sql.raw(p.dir === 'asc' ? 'asc' : 'desc')}, n.id limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from app.notifications n where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  return { rows: rows.rows.map(notificationRowOf), total, page: all ? 1 : p.page, pageSize: limit };
}
export async function getNotificationPanel(): Promise<NotificationPanel> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, notificationPanelTx);
}
export async function listNotifications(params: NotificationListParams): Promise<Paged<NotificationRow>> {
  const { ctx } = await authorize(ANY);
  return withUserTx(ctx, (tx) => notificationRows(tx, params, false));
}

/** ServerShell: one transaction for the bell and the privacy-notice link. Never throws (the shell must render). */
export async function getShellStatus(): Promise<ShellStatus> {
  const empty: ShellStatus = { notifications: { items: [], unreadCount: 0 }, privacyNoticePublished: false, hasEmployeeRecord: false };
  const c = await getUserContext();
  if (!c) return empty;
  try {
    return await withUserTx(c.ctx, async (tx) => ({
      notifications: await notificationPanelTx(tx),
      privacyNoticePublished: (await sql<{ p: boolean }>`select exists (select 1 from app.privacy_notices where is_current) as p`.execute(tx)).rows[0]?.p ?? false,
      hasEmployeeRecord: !!(await myEmployee(tx)),
    }));
  } catch {
    return empty;
  }
}

// ===========================================================================
// G6 Account settings + notification preferences
// ===========================================================================
export function audiencesOf(user: Pick<CurrentUser, 'roles' | 'isExternal'>): Set<PreferenceAudience> {
  const a = new Set<PreferenceAudience>(['all']);
  if (user.roles.includes('EMP')) a.add('employee');
  if (user.roles.some((r) => r === 'MGR' || r === 'ADM' || r === 'SA')) a.add('approver');
  if (user.roles.some((r) => r === 'ADM' || r === 'SA')) a.add('admin');
  if (user.roles.includes('SA')) a.add('super_admin');
  return a;
}
export function groupsFor(user: Pick<CurrentUser, 'roles' | 'isExternal'>): NotificationPreferenceGroupDef[] {
  const a = audiencesOf(user);
  return NOTIFICATION_PREFERENCE_GROUPS.filter((g) => a.has(g.audience));
}
export async function preferencesTx(tx: Tx, user: Pick<CurrentUser, 'roles' | 'isExternal'>): Promise<NotificationPreferences> {
  const off = new Set((await sql<{ event_code: string }>`select event_code from app.notification_preferences
      where user_id = app.current_app_user_id() and not email_enabled`.execute(tx)).rows.map((r) => r.event_code));
  return {
    groups: groupsFor(user).map((g) => ({
      key: g.key, label: g.label, description: g.description, category: g.category,
      emailEnabled: g.mandatory ? true : !g.eventCodes.some((c) => off.has(c)),
      inAppEnabled: true, mandatory: g.mandatory, lockedReason: g.mandatory ? 'Required' : null,
    })),
  };
}
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const { ctx, user } = await authorize(ANY);
  return withUserTx(ctx, (tx) => preferencesTx(tx, user));
}

export async function getAccountSettings(): Promise<AccountSettings> {
  const { ctx, user } = await authorize(ANY);
  return withUserTx(ctx, async (tx) => {
    const p = (await sql<R>`select * from app.current_user_profile()`.execute(tx)).rows[0] ?? {};
    const privileged = user.roles.includes('ADM') || user.roles.includes('SA');
    const delegation = !user.isExternal && user.roles.some((r) => r === 'MGR' || r === 'ADM' || r === 'SA');
    const tabs: AccountTab[] = ['password', 'notifications', ...(delegation ? (['delegation'] as AccountTab[]) : []), ...(privileged ? (['two_factor'] as AccountTab[]) : [])];
    return {
      displayName: user.displayName, loginEmail: user.email, isExternal: user.isExternal, hasEmployeeRecord: !!p.employee_id, tabs,
      twoFactor: {
        applicable: privileged, enrolled: !!p.mfa_enrolled, required: !!p.mfa_required, verifiedThisSession: p.aal === 'aal2',
        note: 'Reset requires a Super Admin.',
      },
      passwordPolicy: { minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH, rules: [...PASSWORD_RULES] },
    };
  });
}
