import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listWorkflows } from '@/server/queries/leave';
import type { WorkflowListParams } from '@/server/contracts/leave';
import { WorkflowsList } from '@/components/leave/SetupScreens';
import { WORKFLOW_FILTERS } from '@/components/leave/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Approval workflows' };
export const dynamic = 'force-dynamic';

// L12 · S-LV-12 · /leave/setup/workflows — Admin and Super Admin.
export default async function WorkflowsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['ADM', 'SA']);
  const lp = readListParams(await searchParams, { filters: WORKFLOW_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const f = lp.filters;
  const params: WorkflowListParams = { ...toPageParams(lp, ['name'] as const), active: f.active === 'active' || f.active === 'inactive' ? f.active : 'all' };
  const list = await listWorkflows(params);
  return <WorkflowsList rows={list.rows} total={list.total} params={params} />;
}
