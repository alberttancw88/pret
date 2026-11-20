import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getApplyLeaveForm } from '@/server/queries/leave';
import ApplyLeaveForm from '@/components/leave/ApplyLeaveForm';
import PageTitle from '@/components/shell/PageTitle';
import { uuidOrUndef } from '@/components/employees/filters';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Apply leave on behalf' };
export const dynamic = 'force-dynamic';

// L2 · S-LV-02 · /leave/apply-on-behalf?employee={id} — Admin and Super Admin; never for the own record
// (the server returns null / refuses). The form (eligible types incl. hidden ones, balances) is loaded for
// the chosen employee on the server.
export default async function ApplyOnBehalfPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const employeeId = uuidOrUndef(spValue(sp, 'employee') ?? '');
  const form = employeeId ? await getApplyLeaveForm(employeeId) : null;
  const picked = form && !form.employee.isSelf ? { id: form.employee.id, employeeNo: form.employee.employeeNo, name: form.employee.name } : null;
  return (
    <>
      <PageTitle title="Apply leave on behalf" breadcrumbs={[{ label: 'Leave', href: '/leave/applications' }, { label: 'Apply on behalf' }]} />
      <ApplyLeaveForm
        key={picked?.id ?? 'none'}
        form={picked ? form : null}
        mode="behalf"
        employee={picked}
        initialTypeCode={spValue(sp, 'type') ?? null}
        notFoundEmployee={Boolean(employeeId) && !picked}
      />
    </>
  );
}
