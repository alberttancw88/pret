import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLeaveBands, getLeaveSetupOptions } from '@/server/queries/leave';
import { BandsEditor } from '@/components/leave/SetupScreens';
import EmptyState from '@/components/EmptyState';
import { yearOrUndef } from '@/components/leave/filters';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Entitlement bands' };
export const dynamic = 'force-dynamic';

// L10 · S-LV-10 · /leave/setup/bands?type=AL&year= — Admin and Super Admin (SA may override BR-LV-02 with a reason).
export default async function BandsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const options = await getLeaveSetupOptions();
  const banded = options.leaveTypes.filter((t) => t.entitlementMethod === 'annual_banded');
  const code = (spValue(sp, 'type') ?? banded[0]?.code ?? '').toUpperCase();
  const type = banded.find((t) => t.code === code) ?? banded[0];
  if (!type) return <EmptyState title="No banded leave types configured." helper="Create an Annual-banded leave type first." />;
  const set = await getLeaveBands(type.id, yearOrUndef(spValue(sp, 'year') ?? ''));
  if (!set) return <EmptyState title="No bands for this type yet." />;
  return <BandsEditor key={`${set.leaveType.id}-${set.effectiveYear}`} set={set} options={options} isSuperAdmin={user.roles.includes('SA')} />;
}
