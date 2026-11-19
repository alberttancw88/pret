import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getEmployeeFormOptions } from '@/server/queries/employees';
import { getOrgOptions } from '@/server/queries/org';
import NewEmployeeWizard from '@/components/employees/NewEmployeeWizard';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'New employee' };
export const dynamic = 'force-dynamic';

// E2 · S-EM-02 · /employees/new — Admin and Super Admin (F-EMP-02). createEmployee re-checks the role.
export default async function NewEmployeePage() {
  const user = await requireUser(['ADM', 'SA']);
  const [org, formOptions] = await Promise.all([getOrgOptions(), getEmployeeFormOptions()]);
  return (
    <>
      <PageTitle title="New employee" breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: 'New employee' }]} />
      <NewEmployeeWizard org={org} formOptions={formOptions} isSuperAdmin={user.roles.includes('SA')} />
    </>
  );
}
