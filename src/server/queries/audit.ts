import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import { authorize, iso, likeTerm, resolveNames } from '../lib/action-helpers';
import {
  accessReviewMonthSchema, auditEntryRefSchema, auditListParamsSchema,
  type AccessReview, type AuditAction, type AuditChange, type AuditEntryDetail, type AuditEntryRef, type AuditFilterOptions,
  type AuditListParams, type AuditRow, type AuditSource, type DataCategory, type Paged, type UserStatus, type UserType,
} from '../contracts/users';
import { EXPORT_LIMIT, parseParams } from './org';
import { SYSTEM_ACTOR_ID } from './users';

// A9/A10 audit & access log viewer and access review (SA only — audit.* RLS is P-SA too).
// Append-only: there is no update/delete path anywhere in the app (BR-ADM-20).

type Where = ReturnType<typeof sql>;
const and = (c: Where[]): Where => (c.length ? sql.join(c, sql` and `) : sql`true`);
const fromTs = (d: string) => sql`(${d}::date::timestamp at time zone 'Asia/Kuala_Lumpur')`;
const toTs = (d: string) => sql`((${d}::date + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')`;

type AuditDb = {
  source: AuditSource; id: string; occurred_at: Date; actor_user_id: string | null; actor_user_type: UserType | null; actor_roles: string[];
  actor_label: string | null; action: AuditAction; entity_type: string; entity_id: string | null; entity_ref: string | null;
  employee_ids: string[]; data_categories: DataCategory[]; reason: string | null;
};

function unionFor(from: string, to: string) {
  return sql`(
    select 'audit'::text as source, a.id::text as id, a.occurred_at, a.actor_user_id, a.actor_user_type::text as actor_user_type,
           a.actor_roles, a.actor_label, a.action::text as action, a.entity_type, a.entity_id, a.entity_ref,
           case when a.employee_id is null then '{}'::uuid[] else array[a.employee_id] end as employee_ids,
           a.data_categories::text[] as data_categories, a.reason
      from audit.audit_log a where a.occurred_at >= ${fromTs(from)} and a.occurred_at < ${toTs(to)}
    union all
    select 'access', l.id::text, l.occurred_at, l.actor_user_id, l.actor_user_type::text, l.actor_roles, null, l.action::text,
           l.entity_type, l.entity_id, l.entity_ref, l.employee_ids, l.data_categories::text[], l.reason
      from audit.access_log l where l.occurred_at >= ${fromTs(from)} and l.occurred_at < ${toTs(to)}) x`;
}

function mapRow(r: AuditDb, names: Map<string, string>): AuditRow {
  return {
    key: `${r.source}:${r.id}`, source: r.source, id: r.id, occurredAt: iso(r.occurred_at)!,
    actorUserId: r.actor_user_id, actorName: r.actor_user_id ? names.get(r.actor_user_id) ?? null : null,
    actorUserType: r.actor_user_type, actorRoles: r.actor_roles ?? [], actorLabel: r.actor_label, action: r.action,
    entityType: r.entity_type, entityId: r.entity_id, entityRef: r.entity_ref, employeeIds: r.employee_ids ?? [],
    dataCategories: r.data_categories ?? [], reason: r.reason,
  };
}

export async function auditRows(tx: Tx, params: AuditListParams, all = false): Promise<Paged<AuditRow>> {
  const p = parseParams(auditListParamsSchema, params);
  const q = likeTerm(p.q);
  const where = and([
    ...(p.actorUserId ? [sql`x.actor_user_id = ${p.actorUserId}::uuid`] : []),
    ...(p.externalOnly ? [sql`x.actor_user_type = 'external'`] : []),
    ...(p.actions?.length ? [sql`x.action = any(${p.actions}::text[])`] : []),
    ...(p.entityType ? [sql`x.entity_type = ${p.entityType}`] : []),
    ...(p.employeeId ? [sql`${p.employeeId}::uuid = any(x.employee_ids)`] : []),
    ...(p.categories?.length ? [sql`x.data_categories && ${p.categories}::text[]`] : []),
    ...(q ? [sql`x.entity_ref ilike ${q}`] : []),
  ]);
  const from = unionFor(p.from, p.to);
  const limit = all ? EXPORT_LIMIT * 5 : p.pageSize;
  const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = await sql<AuditDb>`select x.* from ${from} where ${where}
     order by x.occurred_at ${sql.raw(p.dir === 'asc' ? 'asc' : 'desc')}, x.source, x.id::bigint desc
     limit ${limit} offset ${offset}`.execute(tx);
  const total = (await sql<{ n: number }>`select count(*)::int as n from ${from} where ${where}`.execute(tx)).rows[0]?.n ?? 0;
  const names = await resolveNames(tx, rows.rows.map((r) => r.actor_user_id));
  return { rows: rows.rows.map((r) => mapRow(r, names)), total, page: all ? 1 : p.page, pageSize: all ? limit : p.pageSize };
}

export async function listAuditEntries(params: AuditListParams): Promise<Paged<AuditRow>> {
  const { ctx } = await authorize(['SA']);
  return withUserTx(ctx, (tx) => auditRows(tx, params));
}

// Field values that are always hidden (ciphertext / hashes) and those masked until a logged reveal.
const ALWAYS_REDACTED = /(_enc|_bidx|token_hash)$/;
const SENSITIVE_FIELD = /(nric|mykad|passport|bank|account_no|salary|wage|compensation|religion|oku|medical|diagnos|dob|birth|address|addr_|phone|mobile|personal_email|tax_no|epf|socso|eis|pcb|zakat|ptptn|asnb)/i;

function show(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

export async function auditEntry(tx: Tx, ref: AuditEntryRef, reveal: boolean): Promise<AuditEntryDetail | null> {
  const r = auditEntryRefSchema.parse(ref);
  if (r.source === 'audit') {
    const a = (await sql<AuditDb & { changes: Record<string, unknown> | null; ip: string | null; user_agent: string | null; request_id: string | null; on_behalf_employee_id: string | null }>`
      select 'audit'::text as source, a.id::text as id, a.occurred_at, a.actor_user_id, a.actor_user_type::text as actor_user_type, a.actor_roles,
             a.actor_label, a.action::text as action, a.entity_type, a.entity_id, a.entity_ref,
             case when a.employee_id is null then '{}'::uuid[] else array[a.employee_id] end as employee_ids,
             a.data_categories::text[] as data_categories, a.reason, a.changes, host(a.ip) as ip, a.user_agent,
             a.request_id::text as request_id, a.on_behalf_employee_id
        from audit.audit_log a where a.id = ${r.id}::bigint`.execute(tx)).rows[0];
    if (!a) return null;
    const names = await resolveNames(tx, [a.actor_user_id]);
    const sensitiveEntry = (a.data_categories ?? []).length > 0;
    const changes: AuditChange[] = Object.entries(a.changes ?? {}).map(([field, v]) => {
      const arr = Array.isArray(v) ? v : [null, v];
      if (ALWAYS_REDACTED.test(field) || (arr.length === 1 && arr[0] === '[redacted]')) {
        return { field, before: arr.length > 1 && arr[0] != null ? '[encrypted]' : null, after: '[encrypted]', masked: true };
      }
      const before = show(arr.length > 1 ? arr[0] : null);
      const after = show(arr.length > 1 ? arr[1] : arr[0]);
      const masked = !reveal && (sensitiveEntry || SENSITIVE_FIELD.test(field));
      return { field, before: masked && before != null ? '••••' : before, after: masked && after != null ? '••••' : after, masked };
    });
    return {
      ...mapRow(a, names), changes, fields: [], recordCount: null, ip: a.ip, userAgent: a.user_agent, requestId: a.request_id,
      onBehalfEmployeeId: a.on_behalf_employee_id, fileId: null, revealed: reveal && changes.some((c) => c.masked),
    };
  }
  const l = (await sql<AuditDb & { fields: string[]; record_count: number | null; ip: string | null; user_agent: string | null; request_id: string | null; file_id: string | null }>`
    select 'access'::text as source, l.id::text as id, l.occurred_at, l.actor_user_id, l.actor_user_type::text as actor_user_type, l.actor_roles,
           null::text as actor_label, l.action::text as action, l.entity_type, l.entity_id, l.entity_ref, l.employee_ids,
           l.data_categories::text[] as data_categories, l.reason, l.fields, l.record_count, host(l.ip) as ip, l.user_agent,
           l.request_id::text as request_id, coalesce(l.file_id, l.export_file_id) as file_id
      from audit.access_log l where l.id = ${r.id}::bigint`.execute(tx)).rows[0];
  if (!l) return null;
  const names = await resolveNames(tx, [l.actor_user_id]);
  return {
    ...mapRow(l, names), changes: [], fields: l.fields ?? [], recordCount: l.record_count, ip: l.ip, userAgent: l.user_agent,
    requestId: l.request_id, onBehalfEmployeeId: null, fileId: l.file_id, revealed: false,
  };
}

export async function getAuditEntry(ref: AuditEntryRef): Promise<AuditEntryDetail | null> {
  const { ctx } = await authorize(['SA']);
  return withUserTx(ctx, (tx) => auditEntry(tx, ref, false));
}

export async function getAuditFilterOptions(): Promise<AuditFilterOptions> {
  const { ctx } = await authorize(['SA']);
  return withUserTx(ctx, async (tx) => {
    const actors = await sql<{ id: string; display_name: string; user_type: UserType }>`
      select id, display_name, user_type::text as user_type from app.app_users where id <> ${SYSTEM_ACTOR_ID}::uuid order by display_name`.execute(tx);
    const types = await sql<{ t: string }>`
      select t from (select distinct entity_type as t from audit.audit_log union select distinct entity_type from audit.access_log) s order by t limit 300`.execute(tx);
    return { actors: actors.rows.map((a) => ({ id: a.id, displayName: a.display_name, userType: a.user_type })), entityTypes: types.rows.map((t) => t.t) };
  });
}

// ---------------------------------------------------------------------------
// A10 Access review
// ---------------------------------------------------------------------------
export async function accessReview(tx: Tx, month: string): Promise<AccessReview> {
  const m = accessReviewMonthSchema.parse({ month }).month;
  const start = `${m}-01`;
  const mStart = sql`(${start}::date::timestamp at time zone 'Asia/Kuala_Lumpur')`;
  const mEnd = sql`((${start}::date + interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')`;
  const users = await sql<{ id: string; display_name: string; user_type: UserType; roles: string[]; status: UserStatus; last_login_at: Date | null; days: number | null; service_provider: string | null; access_end_date: string | null; employee_id: string | null }>`
    select u.id, u.display_name, u.user_type::text as user_type,
           array(select r.role::text from app.user_roles r where r.user_id = u.id and r.revoked_at is null order by r.role desc) as roles,
           case when u.status = 'active' and u.locked_until > now() then 'locked'
                when u.status = 'active' and u.access_end_date < app.today_myt() then 'expired' else u.status::text end as status,
           u.last_login_at, (app.today_myt() - (u.last_login_at at time zone 'Asia/Kuala_Lumpur')::date)::int as days,
           u.service_provider, u.access_end_date, u.employee_id
      from app.app_users u where u.id <> ${SYSTEM_ACTOR_ID}::uuid order by u.display_name`.execute(tx);
  const counts = await sql<{ actor_user_id: string; opened: number; sensitive: number; exports: number }>`
    select actor_user_id,
           count(*) filter (where action = 'record_open')::int as opened,
           count(*) filter (where action in ('view_sensitive','reveal','download'))::int as sensitive,
           count(*) filter (where action = 'export')::int as exports
      from audit.access_log where occurred_at >= ${mStart} and occurred_at < ${mEnd} and actor_user_type = 'external'
     group by actor_user_id`.execute(tx);
  const cmap = new Map(counts.rows.map((c) => [c.actor_user_id, c]));
  const roleChanges = await sql<{ occurred_at: Date; actor_user_id: string | null; changes: Record<string, unknown> | null; action: string; entity_id: string | null }>`
    select occurred_at, actor_user_id, changes, action::text as action, entity_id
      from audit.audit_log where entity_type = 'user_roles' and occurred_at >= ${mStart} and occurred_at < ${mEnd}
     order by occurred_at`.execute(tx);
  const bankExport = await sql<{ occurred_at: Date; actor_user_id: string }>`
    select b.occurred_at, b.actor_user_id
      from audit.audit_log b
     where b.entity_type = 'employee_bank_accounts' and b.action = 'create' and b.actor_user_id is not null
       and b.occurred_at >= ${mStart} and b.occurred_at < ${mEnd}
       and exists (select 1 from audit.access_log e
                    where e.actor_user_id = b.actor_user_id and e.action = 'export'
                      and e.entity_type in ('disbursement_batches','hlb_claims_payment_list','salary_payment_list','export_files')
                      and e.occurred_at between b.occurred_at - interval '7 days' and b.occurred_at + interval '7 days')`.execute(tx);
  const saEmployees = users.rows.filter((u) => u.roles.includes('SA') && u.employee_id).map((u) => u.employee_id!);
  const comp = saEmployees.length
    ? await sql<{ occurred_at: Date; actor_user_id: string | null }>`
        select occurred_at, actor_user_id from audit.audit_log
         where entity_type = 'employee_compensation' and employee_id = any(${saEmployees}::uuid[])
           and occurred_at >= ${mStart} and occurred_at < ${mEnd}`.execute(tx)
    : { rows: [] as { occurred_at: Date; actor_user_id: string | null }[] };
  const rev = (await sql<{ reviewed_at: Date; reviewed_by: string; remarks: string | null }>`
    select reviewed_at, reviewed_by, remarks from app.access_reviews where review_month = ${start}::date`.execute(tx)).rows[0];
  const names = await resolveNames(tx, [
    ...roleChanges.rows.map((r) => r.actor_user_id), ...bankExport.rows.map((r) => r.actor_user_id),
    ...comp.rows.map((r) => r.actor_user_id), rev?.reviewed_by, ...users.rows.map((u) => u.id),
  ]);
  const roleOf = (c: Record<string, unknown> | null): string => {
    const v = c?.role;
    return Array.isArray(v) ? String(v[1] ?? v[0] ?? '') : '';
  };
  return {
    month: m,
    users: users.rows.map((u) => ({ userId: u.id, displayName: u.display_name, userType: u.user_type, roles: u.roles, status: u.status, lastLoginAt: iso(u.last_login_at), daysSinceLogin: u.days })),
    externalUsers: users.rows.filter((u) => u.user_type === 'external').map((u) => ({
      userId: u.id, displayName: u.display_name, serviceProvider: u.service_provider, accessEndDate: u.access_end_date,
      recordsOpened: cmap.get(u.id)?.opened ?? 0, sensitiveViews: cmap.get(u.id)?.sensitive ?? 0, exports: cmap.get(u.id)?.exports ?? 0,
    })),
    flags: [
      ...bankExport.rows.map((b) => ({ kind: 'bank_change_and_payment_export' as const, occurredAt: iso(b.occurred_at)!, actorName: names.get(b.actor_user_id) ?? null,
        description: 'Bank details changed and a payment list exported by the same user within 7 days (EC-ADM-04).' })),
      ...comp.rows.map((c) => ({ kind: 'sa_own_compensation_change' as const, occurredAt: iso(c.occurred_at)!, actorName: c.actor_user_id ? names.get(c.actor_user_id) ?? null : null,
        description: "A Super Admin's compensation was changed." })),
      ...roleChanges.rows.map((r) => ({ kind: 'privileged_role_change' as const, occurredAt: iso(r.occurred_at)!,
        actorName: r.actor_user_id ? names.get(r.actor_user_id) ?? null : 'PRET System',
        description: `${roleOf(r.changes) || 'Privileged'} role ${r.action === 'create' ? 'granted' : 'revoked'}.` })),
    ],
    review: rev ? { reviewedAt: iso(rev.reviewed_at)!, reviewedByName: names.get(rev.reviewed_by) ?? null, remarks: rev.remarks } : null,
  };
}

export async function getAccessReview(month: string): Promise<AccessReview> {
  const { ctx } = await authorize(['SA']);
  return withUserTx(ctx, (tx) => accessReview(tx, month));
}
