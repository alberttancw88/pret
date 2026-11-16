import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getRolePermissionMatrix } from '@/server/queries/users';
import RoleReference from '@/components/access/RoleReference';

export const metadata: Metadata = { title: 'Role reference' };
export const dynamic = 'force-dynamic';

// A8 · S-AC-04 · /users/roles — Admin and Super Admin (F-ADM-08). Read-only PRD §16 matrix.
export default async function RoleReferencePage() {
  await requireUser(['ADM', 'SA']);
  const m = await getRolePermissionMatrix();
  return <RoleReference roles={m.roles} matrix={m.rows} legend={m.legend} />;
}
