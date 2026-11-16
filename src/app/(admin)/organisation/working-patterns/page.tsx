import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getWorkingPattern, listWorkingPatterns } from '@/server/queries/org';
import type { PatternListParams } from '@/server/contracts/org';
import WorkingPatternsList from '@/components/org/WorkingPatternsList';
import { PATTERN_FILTERS, isUuid } from '@/components/org/filters';
import { activeParam } from '@/components/org/common';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Working patterns' };
export const dynamic = 'force-dynamic';

// O6 · S-OR-06 · /organisation/working-patterns — Admin and Super Admin (F-ORG-06).
export default async function WorkingPatternsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: PATTERN_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const params: PatternListParams = { ...toPageParams(lp, ['name', 'effectiveFrom'] as const), active: activeParam(lp.filters.active) };
  const editId = spValue(sp, 'edit');
  const [list, detail] = await Promise.all([listWorkingPatterns(params), isUuid(editId) ? getWorkingPattern(editId) : Promise.resolve(null)]);
  return <WorkingPatternsList rows={list.rows} total={list.total} params={params} detail={detail} />;
}
