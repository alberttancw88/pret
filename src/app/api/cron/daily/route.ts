// Daily cron — sends scheduled employee invitations (FR-EMP-02 "join date − 3 days", E2/E15 "Schedule") and, since
// W2-007, sweeps the email outbox (ADR-0010 retry sweep: queued / retrying rows; emails are normally sent right after
// the user's action, this is the once-a-day safety net on Vercel Hobby). Both run in runDailyJobs().
// Called once a day by Vercel Cron (vercel.json, 16:15 UTC = 00:15 MYT, after the 00:05 MYT pg_cron
// job app.run_employee_daily_job). The invitation token may exist only in the email (ADR-0014), so the
// database job cannot send these; runScheduledInvites() is idempotent per user.
//
// Auth: Vercel's cron convention — every request must carry `Authorization: Bearer <CRON_SECRET>`.
// Missing secret in the environment → 503 (never run unauthenticated). The secret is never logged or echoed.
import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { runDailyJobs } from '@/server/jobs/daily';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorised(header: string | null, secret: string): boolean {
  if (!header || !header.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: 'Cron is not configured.' }, { status: 503 });
  if (!authorised(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const run = await runDailyJobs();
    return NextResponse.json({ ok: true, invites: run.invites, email: run.email });
  } catch {
    return NextResponse.json({ ok: false, error: 'Daily jobs failed.' }, { status: 500 });
  }
}
