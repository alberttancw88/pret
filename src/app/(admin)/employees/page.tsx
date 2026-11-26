import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listEmployees } from '@/server/queries/employees';
import { getOrgOptions } from '@/server/queries/org';
import {
  COMPLETENESS_FILTERS,
  EMPLOYMENT_STATUSES,
  MY_STATES,
  PORTAL_ACCOUNT_STATES,
  type EmployeeListParams,
} from '@/server/contracts/employees';
import EmployeesList from '@/components/employees/EmployeesList';
import EmployeeKpiStrip from '@/components/employees/EmployeeKpiStrip';
import { getEmployeeKpis } from '@/server/queries/reports';
import { EMPLOYEE_FILTERS, EMPLOYEE_SORTS, isoOrUndef, pickList, uuidList, uuidOrUndef } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Employees' };
export const dynamic = 'force-dynamic';

// E1 · S-EM-01 · /employees — Admin and Super Admin only (F-EMP-01; MGR/EMP → "Not found or no access").
export default async function EmployeesPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: EMPLOYEE_FILTERS, sort: { key: 'employeeNo', direction: 'asc' } });
  const f = lp.filters;
  const prob = Number(f.probationEndingWithin);
  const params: EmployeeListParams = {
    ...toPageParams(lp, EMPLOYEE_SORTS),
    departmentIds: uuidList(f.departmentIds),
    positionIds: uuidList(f.positionIds),
    gradeIds: uuidList(f.gradeIds),
    locationIds: uuidList(f.locationIds),
    states: pickList(f.states, MY_STATES),
    statuses: pickList(f.statuses, EMPLOYMENT_STATUSES),
    managerId: uuidOrUndef(f.managerId),
    joinFrom: isoOrUndef(f.joinFrom),
    joinTo: isoOrUndef(f.joinTo),
    lwdFrom: isoOrUndef(f.lwdFrom),
    lwdTo: isoOrUndef(f.lwdTo),
    probationEndingWithin: prob === 7 || prob === 14 || prob === 30 || prob === 60 ? prob : undefined,
    completeness: (COMPLETENESS_FILTERS as readonly string[]).includes(f.completeness) ? (f.completeness as EmployeeListParams['completeness']) : undefined,
    portalAccount: pickList(f.portalAccount, PORTAL_ACCOUNT_STATES),
  };
  const [list, options, kpis] = await Promise.all([listEmployees(params), getOrgOptions(), getEmployeeKpis()]);
  return (
    <>
      <EmployeeKpiStrip kpis={kpis} />
      <EmployeesList rows={list.rows} total={list.total} params={params} options={options} />
    </>
  );
}
