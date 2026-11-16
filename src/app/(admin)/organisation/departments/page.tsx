import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getDepartment, getOrgOptions, listDepartments } from '@/server/queries/org';
import type { DepartmentListParams } from '@/server/contracts/org';
import DepartmentsList from '@/components/org/DepartmentsList';
import { DEPARTMENT_FILTERS, isUuid } from '@/components/org/filters';
import { activeParam } from '@/components/org/common';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Departments' };
export const dynamic = 'force-dynamic';

// O2 · S-OR-02 · /organisation/departments — Admin and Super Admin (F-ORG-02).
export default async function DepartmentsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: DEPARTMENT_FILTERS, sort: { key: 'code', direction: 'asc' } });
  const params: DepartmentListParams = {
    ...toPageParams(lp, ['code', 'name', 'parent'] as const),
    active: activeParam(lp.filters.active),
    parentId: isUuid(lp.filters.parentId) ? lp.filters.parentId : undefined,
  };
  const editId = spValue(sp, 'edit');
  const [list, options, detail] = await Promise.all([
    listDepartments(params),
    getOrgOptions(),
    isUuid(editId) ? getDepartment(editId) : Promise.resolve(null),
  ]);
  return (
    <DepartmentsList
      rows={list.rows}
      total={list.total}
      params={params}
      detail={detail}
      options={{ departments: options.departments, costCentres: options.costCentres }}
    />
  );
}
