// "/" routes the user to the right place (IA §4): signed out → /login; privileged user
// without MFA at aal2 → /mfa; Admin/Super Admin → /dashboard; everyone else → /home.
// A safe relative `next` deep link is honoured once signed in.
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import { isAdmin, landingPath } from '@/components/shell/nav';

export const dynamic = 'force-dynamic';

function safeNext(next: string | string[] | undefined): string | null {
  const v = Array.isArray(next) ? next[0] : next;
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return null;
  return v;
}

export default async function RootPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const user = await getCurrentUser();

  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  if (isAdmin(user) && !user.mfaVerified) redirect(next ? `/mfa?next=${encodeURIComponent(next)}` : '/mfa');
  redirect(next ?? landingPath(user));
}
