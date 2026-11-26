import 'server-only';
import { sql, withJobTx } from '../db';
import { dispatchOutbox, type DispatchRun } from '../email/dispatch';
import { runScheduledInvites, type ScheduledInviteRun } from './scheduled-invites';

// W2-007 — everything the once-a-day Vercel cron does (Hobby plan: one cron per day, D27):
//   1. scheduled employee invitations (W2-003)
//   2. email outbox retry sweep (ADR-0010) — sends every due row (in rounds of up to 100; Resend free plan ≈ 100 emails/day)
// The database-side nightly jobs (pg_cron: employee-daily 00:05, leave-daily 00:10, notification-daily 00:20 MYT) create the
// reminders, digests and HR alerts (F-NTF-03/04); this sweep delivers whatever they queued.
// Wiring (frontend lane): src/app/api/cron/daily/route.ts → `const result = await runDailyJobs()` instead of runScheduledInvites().

export type DailyJobsRun = { invites: ScheduledInviteRun | { error: true }; email: DispatchRun };

export async function runDailyJobs(): Promise<DailyJobsRun> {
  let invites: DailyJobsRun['invites'];
  try { invites = await runScheduledInvites(); } catch { invites = { error: true }; }
  const email: DispatchRun = { picked: 0, sent: 0, failed: 0, suppressed: 0, skipped: null };
  for (let round = 0; round < 3; round += 1) {
    const r = await dispatchOutbox({ limit: 100 });
    email.picked += r.picked; email.sent += r.sent; email.failed += r.failed; email.suppressed += r.suppressed; email.skipped = r.skipped;
    if (r.skipped || r.picked < 100) break;
  }
  try {
    await withJobTx('email-dispatch', async (tx) => {
      await sql`insert into app.job_runs (job_name, business_date, status, finished_at, summary)
                values ('email-sweep', app.today_myt(), ${email.skipped === 'error' ? 'failed' : 'succeeded'}::app.job_status, now(), ${JSON.stringify(email)}::jsonb)
                on conflict do nothing`.execute(tx);
    });
  } catch { /* monitoring only */ }
  return { invites, email };
}
