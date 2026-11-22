// Filter options for claims lists, from queries the viewer's role may call (no new server code):
//   ADM/SA → listCategories (all categories) + getLeaveSetupOptions (departments) + listBatches (batch picker / AutoCount source);
//   MGR/EMP → getDirectoryFilterOptions (departments) + the categories on their own claim form.
import 'server-only';
import type { CurrentUser } from '@/server/auth/current-user';
import { getClaimForm, listBatches, listCategories } from '@/server/queries/claims';
import { getLeaveSetupOptions } from '@/server/queries/leave';
import { getDirectoryFilterOptions } from '@/server/queries/employees';
import type { CategoryRef } from '@/server/contracts/claims';

export type ClaimFilterOptions = {
  departments: { id: string; label: string }[];
  categories: { id: string; label: string }[];
  categoryRefs: CategoryRef[];
  batches: { id: string; batchNo: string }[];
};

export const isAdminUser = (u: CurrentUser) => u.roles.includes('ADM') || u.roles.includes('SA');

export async function claimFilterOptions(user: CurrentUser): Promise<ClaimFilterOptions> {
  if (isAdminUser(user)) {
    const [cats, setup, batches] = await Promise.all([
      listCategories({ page: 1, pageSize: 100, active: 'all', sort: 'order', dir: 'asc' }),
      getLeaveSetupOptions(),
      listBatches({ page: 1, pageSize: 100, sort: 'month', dir: 'desc' }),
    ]);
    return {
      departments: setup.departments,
      categories: cats.rows.map((c) => ({ id: c.id, label: c.name })),
      categoryRefs: cats.rows.map((c) => ({ id: c.id, code: c.code, name: c.name, group: c.group, isMileage: c.isMileage })),
      batches: batches.rows.filter((b) => b.status !== 'cancelled').map((b) => ({ id: b.id, batchNo: b.batchNo })),
    };
  }
  const [dir, form] = await Promise.all([getDirectoryFilterOptions(), getClaimForm().catch(() => null)]);
  const refs: CategoryRef[] = (form?.categories ?? []).map((c) => ({ id: c.id, code: c.code, name: c.name, group: c.group, isMileage: c.isMileage }));
  return { departments: dir.departments, categories: refs.map((c) => ({ id: c.id, label: c.name })), categoryRefs: refs, batches: [] };
}
