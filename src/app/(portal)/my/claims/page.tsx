import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getClaimForm, getMyClaimLimits, listMyClaims } from '@/server/queries/claims';
import { CLAIM_STATUSES, type CategoryRef, type MyClaimsParams } from '@/server/contracts/claims';
import MyClaimsList from '@/components/claims/MyClaims';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import { MY_CLAIM_FILTERS, MY_CLAIM_SORTS } from '@/components/claims/filters';
import { yearOrUndef } from '@/components/leave/filters';
import { isoOrUndef, pickList, uuidList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'My claims' };
export const dynamic = 'force-dynamic';

// P12 · S-PT-12 · /my/claims — own claims only (server-scoped), utilisation panel (F-CLM-20).
export default async function MyClaimsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const currentYear = Number(todayMyt().slice(0, 4));
  const lp = readListParams(await searchParams, { filters: { ...MY_CLAIM_FILTERS, year: String(currentYear) }, sort: { key: 'created', direction: 'desc' } });
  const f = lp.filters;
  const pp = toPageParams(lp, MY_CLAIM_SORTS);
  const params: MyClaimsParams = {
    ...pp,
    dir: pp.sort ? pp.dir : 'desc',
    statuses: pickList(f.statuses, CLAIM_STATUSES),
    categoryIds: uuidList(f.categoryIds),
    year: yearOrUndef(f.year),
    from: isoOrUndef(f.from),
    to: isoOrUndef(f.to),
  };
  const [page, limits, form] = await Promise.all([listMyClaims(params), getMyClaimLimits(), getClaimForm().catch(() => null)]);
  if (!page.hasEmployeeRecord) return <NoEmployeeRecord />;
  const categories: CategoryRef[] = (form?.categories ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name, group: c.group, isMileage: c.isMileage }));
  return <MyClaimsList page={page} params={params} categories={categories} utilisation={limits} currentYear={currentYear} />;
}
