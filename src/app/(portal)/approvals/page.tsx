import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getInboxCounts, listInbox } from '@/server/queries/approvals';
import { INBOX_TABS, type InboxParams, type InboxTab } from '@/server/contracts/approvals';
import ApprovalsInbox from '@/components/approvals/Inbox';
import { INBOX_FILTERS, INBOX_SORTS } from '@/components/leave/filters';
import { isoOrUndef, uuidList } from '@/components/employees/filters';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { leaveFilterOptions } from '@/app/_lib/leave-options';
import { claimFilterOptions } from '@/app/_lib/claim-options';
import { CLAIM_FLAGS } from '@/server/contracts/claims';
import { moneyOrUndef } from '@/components/claims/filters';
import { pickList } from '@/components/employees/filters';

export const metadata: Metadata = { title: 'Approvals' };
export const dynamic = 'force-dynamic';

// P26 · S-AP-01 · /approvals?tab= — Manager (items routed to them / as delegate), Admin, Super Admin.
// Claims tabs (W2-005): Claims · Approved claims – not disbursed; "Batches & runs" is SA only.
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['MGR', 'ADM', 'SA']);
  const sp = await searchParams;
  const isAdmin = user.roles.includes('ADM') || user.roles.includes('SA');
  const tabs: InboxTab[] = INBOX_TABS.filter((t) => t !== 'batches' || user.roles.includes('SA'));
  const raw = spValue(sp, 'tab') as InboxTab | undefined;
  const tab: InboxTab = raw && tabs.includes(raw) ? raw : 'leave';
  const lp = readListParams(sp, { filters: INBOX_FILTERS, sort: { key: 'applied', direction: 'asc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, INBOX_SORTS);
  const params: InboxParams = {
    ...pp,
    tab,
    departmentIds: uuidList(f.departmentIds),
    locationIds: uuidList(f.locationIds),
    leaveTypeIds: uuidList(f.leaveTypeIds),
    from: isoOrUndef(f.from),
    to: isoOrUndef(f.to),
    emergencyOnly: f.emergencyOnly === 'yes',
    onlyMine: isAdmin || tab === 'claims' ? f.onlyMine !== 'no' : true,
    categoryIds: uuidList(f.categoryIds),
    amountFrom: moneyOrUndef(f.amountFrom),
    amountTo: moneyOrUndef(f.amountTo),
    flags: pickList(f.flags, CLAIM_FLAGS),
    inBatch: f.inBatch === 'yes' || f.inBatch === 'no' ? f.inBatch : 'any',
  };
  const [counts, page, options, claimOptions] = await Promise.all([
    getInboxCounts(),
    listInbox(params),
    leaveFilterOptions(user),
    tab === 'claims' ? claimFilterOptions(user) : Promise.resolve(null),
  ]);
  return <ApprovalsInbox tab={tab} tabs={tabs} counts={counts} page={page} params={params} options={{ ...options, claimCategories: claimOptions?.categories ?? [] }} isAdmin={isAdmin} />;
}
