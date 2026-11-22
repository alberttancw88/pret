import { redirect } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';

export const dynamic = 'force-dynamic';

// /claims/setup → C5 categories.
export default async function ClaimsSetupPage() {
  await requireUser(['ADM', 'SA']);
  redirect('/claims/setup/categories');
}
