import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getEmployeeFormOptions, getEmployeeProfile } from '@/server/queries/employees';
import { getOrgOptions } from '@/server/queries/org';
import RehireWizard from '@/components/employees/RehireWizard';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Rehire' };
export const dynamic = 'force-dynamic';

// E9 · S-EM-09 · /employees/{no}/rehire — Admin and Super Admin; Separated employees only (can.rehire).
export default async function RehirePage({ params }: { params: Promise<{ employeeNo: string }> }) {
  const user = await requireUser(['ADM', 'SA']);
  const { employeeNo } = await params;
  const profile = await getEmployeeProfile(decodeURIComponent(employeeNo));
  if (!profile || !profile.can.rehire) notFound();
  const [org, formOptions] = await Promise.all([getOrgOptions(), getEmployeeFormOptions()]);
  const no = profile.personal.employeeNo;
  return (
    <>
      <PageTitle title={`Rehire · ${no}`} breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: no, href: `/employees/${encodeURIComponent(no)}` }, { label: 'Rehire' }]} />
      <RehireWizard profile={profile} org={org} formOptions={formOptions} isSuperAdmin={user.roles.includes('SA')} />
    </>
  );
}
