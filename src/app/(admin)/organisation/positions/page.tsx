import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getOrgOptions, getPosition, listPositions } from '@/server/queries/org';
import type { PositionListParams } from '@/server/contracts/org';
import PositionsList from '@/components/org/PositionsList';
import { POSITION_FILTERS, isUuid } from '@/components/org/filters';
import { activeParam } from '@/components/org/common';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Positions' };
export const dynamic = 'force-dynamic';

// O3 · S-OR-03 · /organisation/positions — Admin and Super Admin (F-ORG-03).
export default async function PositionsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: POSITION_FILTERS, sort: { key: 'code', direction: 'asc' } });
  const params: PositionListParams = {
    ...toPageParams(lp, ['code', 'title', 'department', 'grade'] as const),
    active: activeParam(lp.filters.active),
    departmentId: isUuid(lp.filters.departmentId) ? lp.filters.departmentId : undefined,
    gradeId: isUuid(lp.filters.gradeId) ? lp.filters.gradeId : undefined,
  };
  const editId = spValue(sp, 'edit');
  const [list, options, detail] = await Promise.all([
    listPositions(params),
    getOrgOptions(),
    isUuid(editId) ? getPosition(editId) : Promise.resolve(null),
  ]);
  return (
    <PositionsList
      rows={list.rows}
      total={list.total}
      params={params}
      detail={detail}
      options={{ departments: options.departments, grades: options.grades }}
    />
  );
}
