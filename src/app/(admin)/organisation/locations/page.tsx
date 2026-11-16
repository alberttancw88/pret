import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getLocation, getOrgOptions, listLocations } from '@/server/queries/org';
import { MY_STATES, type LocationListParams, type MyState } from '@/server/contracts/org';
import LocationsList from '@/components/org/LocationsList';
import { LOCATION_FILTERS, isUuid } from '@/components/org/filters';
import { activeParam } from '@/components/org/common';
import { optList, readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Work locations' };
export const dynamic = 'force-dynamic';

// O5 · S-OR-05 · /organisation/locations — Admin and Super Admin (F-ORG-05).
export default async function LocationsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const sp = await searchParams;
  const lp = readListParams(sp, { filters: LOCATION_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const states = optList(lp.filters.state)?.filter((s): s is MyState => (MY_STATES as readonly string[]).includes(s));
  const params: LocationListParams = {
    ...toPageParams(lp, ['name', 'state', 'pattern'] as const),
    active: activeParam(lp.filters.active),
    state: states && states.length ? states : undefined,
  };
  const editId = spValue(sp, 'edit');
  const [list, options, detail] = await Promise.all([
    listLocations(params),
    getOrgOptions(),
    isUuid(editId) ? getLocation(editId) : Promise.resolve(null),
  ]);
  return (
    <LocationsList rows={list.rows} total={list.total} params={params} detail={detail} options={{ workingPatterns: options.workingPatterns }} />
  );
}
