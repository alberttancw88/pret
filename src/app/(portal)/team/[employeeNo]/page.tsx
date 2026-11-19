import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getTeamMemberProfile } from '@/server/queries/employees';
import { TeamMemberView } from '@/components/employees/portal/Team';

export const metadata: Metadata = { title: 'Team member' };
export const dynamic = 'force-dynamic';

// P32 · S-AP-07 · /team/{employeeNo} — managers, own reportees only. A non-reportee returns null
// (attempt logged by the server) → "Not found or no access". The DTO carries T1 fields only.
export default async function TeamMemberPage({ params }: { params: Promise<{ employeeNo: string }> }) {
  await requireUser(['MGR']);
  const { employeeNo } = await params;
  const m = await getTeamMemberProfile(decodeURIComponent(employeeNo));
  if (!m) notFound();
  return <TeamMemberView m={m} />;
}
