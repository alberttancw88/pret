import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getEmployeeProfile } from '@/server/queries/employees';
import SeparationForm from '@/components/employees/SeparationForm';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Separation' };
export const dynamic = 'force-dynamic';

// E7 · S-EM-07 · /employees/{no}/separation — Admin and Super Admin; not on the viewer's own
// record and only when the status allows it (server `can` flags; the actions re-check).
export default async function SeparationPage({ params }: { params: Promise<{ employeeNo: string }> }) {
  await requireUser(['ADM', 'SA']);
  const { employeeNo } = await params;
  const profile = await getEmployeeProfile(decodeURIComponent(employeeNo));
  if (!profile) notFound();
  if (!(profile.separation ? profile.can.editSeparation : profile.can.recordSeparation)) notFound();
  const no = profile.personal.employeeNo;
  return (
    <>
      <PageTitle
        title={profile.separation ? `Edit separation · ${no}` : `Record separation · ${no}`}
        breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: no, href: `/employees/${encodeURIComponent(no)}` }, { label: 'Separation' }]}
      />
      <SeparationForm profile={profile} />
    </>
  );
}
