import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getChangeRequestFormOptions, getMyProfile } from '@/server/queries/employees';
import { CR_CATEGORIES, type CrCategory } from '@/server/contracts/employees';
import ChangeRequestForm from '@/components/employees/portal/ChangeRequestForm';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import PageTitle from '@/components/shell/PageTitle';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Request a change' };
export const dynamic = 'force-dynamic';

// P17 · S-PT-17 · /my/profile/change-requests/new?category= — own record only.
// Lookups (banks I2, LHDN branches H5, zakat bodies H31) come from getChangeRequestFormOptions —
// readable by every signed-in role (Q-F2), loaded on the server with the page.
export default async function NewChangeRequestPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const me = await getMyProfile();
  if (!me) return <NoEmployeeRecord />;
  const c = spValue(await searchParams, 'category');
  const initial = c && (CR_CATEGORIES as readonly string[]).includes(c) ? (c as CrCategory) : null;
  const options = await getChangeRequestFormOptions();
  return (
    <>
      <PageTitle title="Request a change" breadcrumbs={[{ label: 'My profile', href: '/my/profile' }, { label: 'Change requests', href: '/my/profile/change-requests' }, { label: 'New' }]} />
      <ChangeRequestForm me={me} initialCategory={initial} options={options} />
    </>
  );
}
