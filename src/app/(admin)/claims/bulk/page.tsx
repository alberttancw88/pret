import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { listCategories } from '@/server/queries/claims';
import BulkEntry from '@/components/claims/BulkEntry';

export const metadata: Metadata = { title: 'Bulk claim entry' };
export const dynamic = 'force-dynamic';

// C3 · S-CL-03 · /claims/bulk — ADM / SA (Could, F-CLM-28).
export default async function BulkClaimsPage() {
  await requireUser(['ADM', 'SA']);
  const cats = await listCategories({ page: 1, pageSize: 100, active: 'active', sort: 'order', dir: 'asc' });
  return <BulkEntry categories={cats.rows} />;
}
