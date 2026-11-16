import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import MfaForm from '@/components/auth/MfaForm';
import { safeNext } from '@/components/auth/types';
import { isAdmin } from '@/components/shell/nav';

export const metadata: Metadata = { title: 'Two-factor verification' };
export const dynamic = 'force-dynamic';

// S-GL-04 · /mfa?mode=enrol|verify — the Backend sends un-enrolled privileged users to
// mode=enrol (first privileged sign-in or after a Super Admin reset); default is verify.
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ mode?: string; next?: string }> }) {
  const { mode, next } = await searchParams;
  const n = safeNext(next) ?? undefined;
  const user = await getCurrentUser();
  if (!user) redirect(n ? `/login?next=${encodeURIComponent(n)}` : '/login');
  if (user.mfaVerified || !isAdmin(user)) redirect(n ? `/?next=${encodeURIComponent(n)}` : '/');
  return <MfaForm mode={mode === 'enrol' ? 'enrol' : 'verify'} next={n} />;
}
