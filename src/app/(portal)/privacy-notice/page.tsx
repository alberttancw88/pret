import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getCurrentPrivacyNotice, listPrivacyNoticeHistory } from '@/server/queries/users';
import PrivacyNoticeView from '@/components/portal/PrivacyNoticeView';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Privacy notice' };
export const dynamic = 'force-dynamic';

// G7 · S-GL-09 · /privacy-notice — every signed-in user (F-ADM-15). No acknowledgement (D14).
export default async function PrivacyNoticePage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  const version = spValue(await searchParams, 'version');
  const [current, history] = await Promise.all([getCurrentPrivacyNotice(), listPrivacyNoticeHistory()]);
  if (version) {
    const old = history.find((h) => h.id === version);
    if (!old) notFound();
    return <PrivacyNoticeView notice={old} history={history} viewingOld={!old.isCurrent} />;
  }
  return <PrivacyNoticeView notice={current} history={history} viewingOld={false} />;
}
