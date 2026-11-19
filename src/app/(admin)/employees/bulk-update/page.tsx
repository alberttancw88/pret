import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import BulkUpdate from '@/components/employees/BulkUpdate';

export const metadata: Metadata = { title: 'Bulk update' };
export const dynamic = 'force-dynamic';

// E14 · S-EM-14 · /employees/bulk-update — Admin and Super Admin (F-EMP-25).
export default async function BulkUpdatePage() {
  await requireUser(['ADM', 'SA']);
  return <BulkUpdate />;
}
