import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getCurrentPrivacyNotice, listPrivacyNoticeHistory } from '@/server/queries/users';
import PrivacyNoticeAdmin from '@/components/access/PrivacyNoticeAdmin';

export const metadata: Metadata = { title: 'Privacy notice' };
export const dynamic = 'force-dynamic';

// A11 · S-AC-08 · /privacy/notice — Admin and Super Admin publish (F-ADM-15, optional).
// (All users read the current notice from S-GL-09 /privacy-notice — not part of W2-002.)
export default async function PrivacyNoticePage() {
  await requireUser(['ADM', 'SA']);
  const [current, history] = await Promise.all([getCurrentPrivacyNotice(), listPrivacyNoticeHistory()]);
  return <PrivacyNoticeAdmin current={current} history={history} />;
}
