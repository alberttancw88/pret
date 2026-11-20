// Filter options for leave lists, from queries the viewer's role may call (no new server code):
//   ADM/SA → getLeaveSetupOptions (all types incl. hidden, departments, locations);
//   MGR/EMP → getDirectoryFilterOptions (departments, locations) + the types on their own apply form.
import 'server-only';
import type { CurrentUser } from '@/server/auth/current-user';
import { getApplyLeaveForm, getLeaveSetupOptions } from '@/server/queries/leave';
import { getDirectoryFilterOptions } from '@/server/queries/employees';
import type { LeaveTypeRef } from '@/server/contracts/leave';

export type LeaveFilterOptions = {
  departments: { id: string; label: string }[];
  locations: { id: string; label: string }[];
  types: LeaveTypeRef[];
};

export async function leaveFilterOptions(user: CurrentUser): Promise<LeaveFilterOptions> {
  if (user.roles.includes('ADM') || user.roles.includes('SA')) {
    const o = await getLeaveSetupOptions();
    return { departments: o.departments, locations: o.locations, types: o.leaveTypes };
  }
  const [dir, form] = await Promise.all([getDirectoryFilterOptions(), getApplyLeaveForm().catch(() => null)]);
  const types = form ? [...form.types, ...form.ineligible.map((i) => i.type)] : [];
  return { departments: dir.departments, locations: dir.locations, types };
}
