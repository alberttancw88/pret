import type { Metadata } from 'next';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = { title: 'Reset password' };
export const dynamic = 'force-dynamic';

// S-GL-03 (reset) · /reset-password?code=… — Supabase's recovery email redirects here.
// The code is exchanged by completePasswordReset; an `error` param means the link failed.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; error_code?: string }>;
}) {
  const { code, error, error_code } = await searchParams;
  const c = code && code.length >= 6 && code.length <= 200 ? code : null;
  return <ResetPasswordForm code={c} linkError={Boolean(error || error_code)} />;
}
