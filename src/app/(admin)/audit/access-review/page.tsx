import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getAccessReview } from '@/server/queries/audit';
import AccessReviewView from '@/components/access/AccessReviewView';
import { spValue, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const metadata: Metadata = { title: 'Access review' };
export const dynamic = 'force-dynamic';

/** Last 24 months as 'yyyy-mm', newest first. */
function recentMonths(today: string, n = 24): string[] {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

// A10 · S-AC-07 · /audit/access-review — Super Admin only (F-ADM-12).
export default async function AccessReviewPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['SA']);
  const sp = await searchParams;
  const months = recentMonths(todayMyt());
  const requested = spValue(sp, 'month');
  // Default: the previous (completed) month.
  const month = requested && months.includes(requested) ? requested : months[1];
  const review = await getAccessReview(month);
  return <AccessReviewView review={review} months={months} />;
}
