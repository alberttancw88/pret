import 'server-only';
import { after } from 'next/server';
import { Resend } from 'resend';
import { sql, withJobTx } from '../db';
import { env } from '../env';
import { backoffMinutes, deliveryDecision, pdpaIssues, renderEmail } from '../lib/email-templates';

// W2-007 F-NTF-01 / ADR-0010 — sends app.email_outbox through Resend.
//   * Prompt: every successful Server Action schedules dispatchOutbox() with next/server after() (runs once the response is
//     sent, so the user's action never waits for or fails because of email).
//   * Sweep: the daily Vercel cron (src/server/jobs/daily.ts) retries everything due (Vercel Hobby: one cron a day).
//   * Rows are claimed with FOR UPDATE SKIP LOCKED and marked 'sending' with a 10-minute lease, so concurrent runs never
//     send the same email twice; the nightly DB job re-queues an expired lease.
//   * Not configured (RESEND_API_KEY / PRET_EMAIL_FROM / PRET_APP_URL missing) → nothing happens; rows stay Queued.
//   * Safety: example/test addresses are Suppressed; unless PRET_EMAIL_DELIVERY=live only allowed-domain addresses or
//     PRET_EMAIL_TEST_RECIPIENTS are emailed (others Suppressed); each email passes the PDPA check or is Failed unsent.

export type DispatchRun = { picked: number; sent: number; failed: number; suppressed: number; skipped: string | null };
export type DeliveryConfig = { configured: boolean; reason: string | null; mode: 'live' | 'restricted'; testRecipients: string[] };

const MAX_ATTEMPTS = 5;
/** Resend free plan: 2 requests / second and 100 emails / day — keep runs small. */
const SEND_GAP_MS = 600;

export function deliveryConfig(): DeliveryConfig {
  const mode = (process.env.PRET_EMAIL_DELIVERY ?? '').trim().toLowerCase() === 'live' ? 'live' : 'restricted';
  const testRecipients = (process.env.PRET_EMAIL_TEST_RECIPIENTS ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const missing = [!env.resendApiKey() && 'RESEND_API_KEY', !env.emailFrom() && 'PRET_EMAIL_FROM', !env.appUrl() && 'PRET_APP_URL'].filter(Boolean) as string[];
  return { configured: missing.length === 0, reason: missing.length ? `not configured: ${missing.join(', ')}` : null, mode, testRecipients };
}

type Claimed = {
  id: string; to_address: string; template_code: string; subject: string; payload: Record<string, unknown>; attempts: number;
  link_path: string | null; recipient_name: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SAFE_LINK = /^\/(?!\/)[A-Za-z0-9/_\-?=&.%]*$/;

/** Sends due outbox rows (at most `limit`). Never throws. */
export async function dispatchOutbox(opts: { limit?: number } = {}): Promise<DispatchRun> {
  const cfg = deliveryConfig();
  const run: DispatchRun = { picked: 0, sent: 0, failed: 0, suppressed: 0, skipped: null };
  if (!cfg.configured) return { ...run, skipped: cfg.reason };
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 100);
  const origin = env.appUrl()!.replace(/\/+$/, '');
  try {
    const ctx = await withJobTx('email-dispatch', async (tx) => {
      const rows = (await sql<Claimed>`
        with due as (
          select o.id from app.email_outbox o
           where (o.status = 'pending' or (o.status = 'failed' and o.attempts < ${MAX_ATTEMPTS}))
             and o.next_attempt_at <= now() and o.created_at > now() - interval '72 hours'
           order by o.next_attempt_at
           limit ${limit}
           for update skip locked)
        update app.email_outbox o set status = 'sending', attempts = o.attempts + 1, next_attempt_at = now() + interval '10 minutes'
          from due where o.id = due.id
        returning o.id, o.to_address::text as to_address, o.template_code, o.subject, o.payload, o.attempts,
                  (select n.link_path from app.notifications n where n.id = o.notification_id) as link_path,
                  (select u.display_name from app.app_users u where u.id = o.to_user_id) as recipient_name`.execute(tx)).rows;
      const settings = (await sql<{ domains: string[] | null; reply_to: string | null; company: string | null }>`
        select (select array(select d::text from unnest(st.allowed_email_domains) d)) as domains, st.hr_reply_to_email::text as reply_to,
               (select cp.legal_name from app.company_profile cp where cp.id = 1) as company
          from app.security_settings st where st.id = 1`.execute(tx)).rows[0];
      const codes = [...new Set(rows.map((r) => r.template_code))];
      const overrides = codes.length
        ? (await sql<{ template_code: string; subject_override: string | null; body_override: string | null }>`
            select template_code, subject_override, body_override from app.notification_templates where template_code = any(${codes}::text[])`.execute(tx)).rows
        : [];
      return { rows, settings, overrides: new Map(overrides.map((o) => [o.template_code, o])) };
    });
    run.picked = ctx.rows.length;
    if (!ctx.rows.length) return run;
    const resend = new Resend(env.resendApiKey()!);
    const from = env.emailFrom()!;
    for (const r of ctx.rows) {
      let outcome: { status: 'sent' | 'failed' | 'suppressed'; error: string | null; providerId: string | null; final?: boolean };
      const decision = deliveryDecision(r.to_address, { mode: cfg.mode, allowedDomains: ctx.settings?.domains ?? [], testRecipients: cfg.testRecipients });
      if (!decision.send) {
        outcome = { status: 'suppressed', error: decision.reason, providerId: null };
      } else {
        const link = r.link_path && SAFE_LINK.test(r.link_path) ? `${origin}${r.link_path}` : null;
        const email = renderEmail({
          templateCode: r.template_code, title: r.subject, payload: r.payload ?? {}, link, origin,
          companyName: ctx.settings?.company ?? 'Interact Technology Sdn Bhd', recipientName: r.recipient_name, override: ((o) => (o ? { subject: o.subject_override, body: o.body_override } : null))(ctx.overrides.get(r.template_code)),
        });
        const issues = pdpaIssues(email, r.payload ?? {});
        if (issues.length) {
          outcome = { status: 'failed', error: 'Blocked by the PDPA check — not sent', providerId: null, final: true };
        } else {
          try {
            const { data, error } = await resend.emails.send({
              from, to: r.to_address, subject: email.subject, text: email.text, html: email.html,
              ...(ctx.settings?.reply_to ? { replyTo: ctx.settings.reply_to } : {}),
            });
            outcome = error
              ? { status: 'failed', error: `Provider error: ${String(error.name ?? 'error').slice(0, 60)}`, providerId: null }
              : { status: 'sent', error: null, providerId: data?.id ?? null };
          } catch {
            outcome = { status: 'failed', error: 'Provider unreachable', providerId: null };
          }
          await sleep(SEND_GAP_MS);
        }
      }
      try {
        await withJobTx('email-dispatch', async (tx) => {
          if (outcome.status === 'sent') {
            await sql`update app.email_outbox set status = 'sent', sent_at = now(), provider_message_id = ${outcome.providerId}, last_error = null
                       where id = ${r.id}::uuid`.execute(tx);
          } else if (outcome.status === 'suppressed') {
            await sql`update app.email_outbox set status = 'suppressed', last_error = ${outcome.error} where id = ${r.id}::uuid`.execute(tx);
          } else {
            const attempts = outcome.final ? MAX_ATTEMPTS : r.attempts;
            await sql`update app.email_outbox set status = 'failed', attempts = ${attempts},
                         next_attempt_at = now() + make_interval(mins => ${backoffMinutes(r.attempts)}), last_error = ${outcome.error}
                       where id = ${r.id}::uuid`.execute(tx);
          }
        });
      } catch {
        // the 10-minute lease expires and the nightly job re-queues the row
      }
      if (outcome.status === 'sent') run.sent += 1; else if (outcome.status === 'suppressed') run.suppressed += 1; else run.failed += 1;
    }
    return run;
  } catch {
    return { ...run, skipped: 'error' };
  }
}

/**
 * Prompt dispatch after the current request (called by runAction on success). Cheap no-op when email is not configured.
 * Errors are swallowed — email never affects the user's action.
 */
export function scheduleDispatch(): void {
  if (!deliveryConfig().configured) return;
  try {
    after(async () => {
      try { await dispatchOutbox({ limit: 10 }); } catch { /* ignored */ }
    });
  } catch {
    // outside a request scope (scripts / tests): the cron sweep will send it
  }
}
