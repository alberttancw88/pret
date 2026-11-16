import type { Metadata } from 'next';
import AcceptInviteForm from '@/components/auth/AcceptInviteForm';

export const metadata: Metadata = { title: 'Set your password' };
export const dynamic = 'force-dynamic';

// S-GL-03 (invite) · /accept-invite?token=… — the token is validated by acceptInvite.
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AcceptInviteForm token={token && token.length >= 16 ? token : null} />;
}
