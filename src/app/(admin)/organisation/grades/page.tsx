import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getGrade, listGrades } from '@/server/queries/org';
import type { GradeListParams } from '@/server/contracts/org';
import GradesList from '@/components/org/GradesList';
import { GRADE_FILTERS, isUuid } from '@/components/org/filters';
import { activeParam } from '@/components/org/common';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Grades' };
export const dynamic = 'force-dynamic';

// O4 · S-OR-04 · /organisation/grades — Admin and Super Admin (F-ORG-04).
export default async function GradesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: GRADE_FILTERS, sort: { key: 'rank', direction: 'asc' } });
  const params: GradeListParams = { ...toPageParams(lp, ['code', 'name', 'rank'] as const), active: activeParam(lp.filters.active) };
  const editId = spValue(sp, 'edit');
  const [list, detail] = await Promise.all([listGrades(params), isUuid(editId) ? getGrade(editId) : Promise.resolve(null)]);
  return <GradesList rows={list.rows} total={list.total} params={params} detail={detail} />;
}
