import 'server-only';
import { sql, withJobTx } from '../db';
import { hashInviteToken, newInviteToken } from '../auth/invitations';
import { companyName, deliverInvitation, SYSTEM_ACTOR_ID } from '../lib/invites';

// Scheduled employee invitations (FR-EMP-02 "invite on join date − 3 days", E2/E15 "Schedule").
// The token must exist only in the email (ADR-0014), so the database job (pg_cron) cannot send these:
// this function is called once a day by a protected route (Vercel Hobby cron — 1 run/day fits D27).
// Idempotent: each user is picked once (invite_scheduled_for cleared when the invitation is issued).
//
// Wiring (frontend / Delivery Lead): src/app/api/cron/daily/route.ts → verify
// `Authorization: Bearer ${process.env.CRON_SECRET}` → `await runScheduledInvites()`; vercel.json
// `"crons": [{ "path": "/api/cron/daily", "schedule": "30 0 * * *" }]` (00:30 UTC = 08:30 MYT).

export type ScheduledInviteRun = { due: number; issued: number; emailed: number; failed: number };

export async function runScheduledInvites(): Promise<ScheduledInviteRun> {
  const due = await withJobTx('scheduled-invites', async (tx) =>
    (await sql<{ id: string; login_email: string; display_name: string }>`
      select u.id, u.login_email::text as login_email, u.display_name from app.app_users u
       where u.user_type = 'employee' and u.status = 'invited' and u.auth_user_id is null
         and u.invite_scheduled_for is not null and u.invite_scheduled_for <= app.today_myt()
       order by u.invite_scheduled_for limit 200`.execute(tx)).rows);
  const out: ScheduledInviteRun = { due: due.length, issued: 0, emailed: 0, failed: 0 };
  for (const u of due) {
    try {
      const issued = await withJobTx('scheduled-invites', async (tx) => {
        const token = newInviteToken();
        await sql`update app.user_invitations set revoked_at = now() where user_id = ${u.id}::uuid and accepted_at is null and revoked_at is null`.execute(tx);
        const r = await sql<{ id: string; expires_at: Date }>`
          insert into app.user_invitations (user_id, token_hash, expires_at, created_by)
          values (${u.id}::uuid, ${hashInviteToken(token)},
                  now() + make_interval(hours => coalesce((select st.invite_link_hours from app.security_settings st where st.id = 1), 72)),
                  ${SYSTEM_ACTOR_ID}::uuid)
          returning id, expires_at`.execute(tx);
        await sql`update app.app_users set invite_scheduled_for = null, invited_by = ${SYSTEM_ACTOR_ID}::uuid, invited_at = now()
                   where id = ${u.id}::uuid`.execute(tx);
        return { token, invitationId: r.rows[0]!.id, expiresAt: r.rows[0]!.expires_at, co: await companyName(tx) };
      });
      out.issued += 1;
      if (await deliverInvitation(issued, { email: u.login_email, displayName: u.display_name }, issued.co)) out.emailed += 1;
    } catch {
      out.failed += 1;
    }
  }
  await withJobTx('scheduled-invites', async (tx) => {
    await sql`insert into app.job_runs (job_name, business_date, status, finished_at, summary)
              values ('scheduled-invites', app.today_myt(), ${out.failed ? 'failed' : 'succeeded'}::app.job_status, now(), ${JSON.stringify(out)}::jsonb)
              on conflict do nothing`.execute(tx);
  });
  return out;
}
