import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getClaimForm } from '@/server/queries/claims';
import ClaimForm from '@/components/claims/ClaimForm';
import PageTitle from '@/components/shell/PageTitle';
import { uuidOrUndef } from '@/components/employees/filters';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Submit claim on behalf' };
export const dynamic = 'force-dynamic';

// C2 · S-CL-02 · /claims/new-on-behalf?employee={id} | ?claim={no} — ADM / SA, never for the own record (server).
export default async function ClaimOnBehalfPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const claimNo = spValue(sp, 'claim');
  const employeeId = uuidOrUndef(spValue(sp, 'employee') ?? '');
  const form = claimNo ? await getClaimForm(claimNo) : employeeId ? await getClaimForm(undefined, employeeId) : null;
  const usable = form && form.isOnBehalf && form.employee.employeeNo !== user.employeeNo ? form : null;
  const employee = usable ? { id: usable.employee.id, employeeNo: usable.employee.employeeNo, name: usable.employee.name } : null;
  return (
    <>
      <PageTitle title={usable?.claim ? `${usable.claim.claimNo} · on behalf` : 'Submit claim on behalf'} breadcrumbs={[{ label: 'Claims', href: '/claims' }, { label: 'Submit on behalf' }]} />
      <ClaimForm form={usable} mode="behalf" employee={employee} />
    </>
  );
}
