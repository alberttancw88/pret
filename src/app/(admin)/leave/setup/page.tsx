import { redirect } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';

export const dynamic = 'force-dynamic';

// /leave/setup → Leave types (IA §3.3 Setup ▸ Leave types · Entitlement bands · Policy · Approval workflows).
export default async function LeaveSetupIndex() {
  await requireUser(['ADM', 'SA']);
  redirect('/leave/setup/types');
}
