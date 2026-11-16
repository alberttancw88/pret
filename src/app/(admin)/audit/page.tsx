import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getAuditEntry, getAuditFilterOptions, listAuditEntries } from '@/server/queries/audit';
import { AUDIT_ACTIONS, DATA_CATEGORIES, type AuditAction, type AuditListParams, type DataCategory } from '@/server/contracts/users';
import AuditLog from '@/components/access/AuditLog';
import { AUDIT_FILTERS } from '@/components/access/filters';
import { isUuid } from '@/components/org/filters';
import { optList, readListParams, spValue, type SearchParamsRecord } from '@/lib/list-params';
import { addDays, todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Audit & access log' };
export const dynamic = 'force-dynamic';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// A9 · S-AC-05 · /audit — Super Admin only (F-ADM-09/10/11). Admins get "Not found or no access" (EC-ADM-03).
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['SA']);
  const sp = await searchParams;
  const today = todayMyt();
  const defaults = { from: addDays(today, -6), to: today };
  const lp = readListParams(sp, { filters: { ...AUDIT_FILTERS, ...defaults }, sort: { key: 'occurredAt', direction: 'desc' } });
  const f = lp.filters;
  const from = ISO.test(f.from) ? f.from : defaults.from;
  const toRaw = ISO.test(f.to) ? f.to : defaults.to;
  const to = toRaw < from ? from : toRaw;
  const actions = optList(f.actions)?.filter((a): a is AuditAction => (AUDIT_ACTIONS as readonly string[]).includes(a));
  const categories = optList(f.categories)?.filter((c): c is DataCategory => (DATA_CATEGORIES as readonly string[]).includes(c));
  const params: AuditListParams = {
    q: f.q || undefined,
    page: lp.page + 1,
    pageSize: lp.rowsPerPage,
    dir: lp.sort?.key === 'occurredAt' ? lp.sort.direction : 'desc',
    from,
    to,
    actorUserId: isUuid(f.actorUserId) ? f.actorUserId : undefined,
    externalOnly: f.externalOnly === 'yes',
    actions: actions?.length ? actions : undefined,
    entityType: f.entityType || undefined,
    categories: categories?.length ? categories : undefined,
  };
  const entryKey = spValue(sp, 'entry');
  const m = entryKey ? /^(audit|access):(\d{1,18})$/.exec(entryKey) : null;
  const [list, options, entry] = await Promise.all([
    listAuditEntries(params),
    getAuditFilterOptions(),
    m ? getAuditEntry({ source: m[1] as 'audit' | 'access', id: m[2] }) : Promise.resolve(null),
  ]);
  return <AuditLog rows={list.rows} total={list.total} params={params} defaults={defaults} options={options} entry={entry} />;
}
