import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/server/auth/current-user';
import LoginForm from '@/components/auth/LoginForm';
import { safeNext } from '@/components/auth/types';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

// S-GL-01 · /login
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const n = safeNext(next) ?? undefined;
  // Already signed in: hand over to "/" which routes by role / MFA state.
  if (await getCurrentUser()) redirect(n ? `/?next=${encodeURIComponent(n)}` : '/');
  return <LoginForm next={n} />;
}
