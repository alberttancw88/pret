'use server';

// M8 notification Server Actions (W2-007). Contract: src/server/contracts/notifications.ts (function register).
// Every action: requireUser([...]) → zod → withUserTx (RLS + definer re-checks) → audit / access log → ActionResult.

import { z } from 'zod';
import { sql, withUserTx } from '../db';
import { writeAccess } from '../audit';
import { fail, runAction, type Input } from '../lib/action-helpers';
import { csvDateTime, csvFile } from '../lib/csv';
import { dispatchOutbox } from '../email/dispatch';
import { pdpaIssues, TEMPLATE_BY_CODE, validateTemplateText } from '../lib/email-templates';
import {
  notificationLogParamsSchema, previewNotificationTemplateSchema, retryEmailSchema, saveNotificationTemplateSchema, templateCodeSchema,
  DELIVERY_STATUS_LABELS, NOTIFICATION_CHANNEL_LABELS, TEMPLATE_PLACEHOLDER_GUARD,
  type ActionResult, type CsvFile, type NotificationLogRow, type NotificationTemplateDetail, type RenderedEmail,
} from '../contracts/notifications';
import { ADMIN, logRowOf, logRows, templateDetailTx, templatePreview } from '../queries/notifications';

const SA = ['SA'] as const;
const EMPTY = z.object({}).passthrough();
const MSGS = { 'PRET-NTF-RETRY': 'Only a failed email can be retried.' };

// ===========================================================================
// A15 Notification log
// ===========================================================================
export async function exportNotificationLogCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, notificationLogParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const page = await logRows(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'notification_log', recordCount: page.rows.length, fields: ['recipient_email'], categories: ['contact'] });
    return csvFile('notification-log', ['Sent at', 'Event', 'Event name', 'Recipient', 'Email', 'Channel', 'Status', 'Attempts', 'Detail', 'Summary', 'Link'],
      page.rows.map((r) => [csvDateTime(r.at), r.eventCode, r.eventName, r.recipientName, r.recipientEmail, NOTIFICATION_CHANNEL_LABELS[r.channel],
        DELIVERY_STATUS_LABELS[r.status], r.attempts, r.statusDetail, r.summary, r.link]));
  }), undefined, MSGS);
}

export async function retryEmail(input: Input): Promise<ActionResult<{ row: NotificationLogRow }>> {
  return runAction(ADMIN, retryEmailSchema, input, async ({ id }, { ctx }) => {
    await withUserTx(ctx, (tx) => sql`select app.retry_email(${id}::uuid)`.execute(tx));
    await dispatchOutbox({ limit: 5 });
    const row = await withUserTx(ctx, async (tx) =>
      (await sql<Record<string, unknown>>`select * from app.notification_log(null, null, array['email'], null, null, null, 'at', 'desc', 10000, 0) where id = ${id}::uuid`.execute(tx)).rows[0]);
    if (!row) return fail('Not found or no access.');
    return { row: logRowOf(row) };
  }, undefined, MSGS);
}

export async function sendQueuedEmailsNow(): Promise<ActionResult<{ sent: number; failed: number; suppressed: number; skipped: string | null }>> {
  return runAction([...SA], EMPTY, {}, async () => {
    const r = await dispatchOutbox({ limit: 50 });
    return { sent: r.sent, failed: r.failed, suppressed: r.suppressed, skipped: r.skipped };
  });
}

// ===========================================================================
// A16 Notification templates (edit = SA; preview = ADM / SA)
// ===========================================================================
function guard(code: string, subject: string, body: string): Record<string, string> | null {
  if (!TEMPLATE_BY_CODE[code]) return { templateCode: 'Unknown template.' };
  const errs: Record<string, string> = {};
  for (const [field, text] of [['subject', subject], ['body', body]] as const) {
    const v = validateTemplateText(code, text);
    if (v.forbidden.length) errs[field] = TEMPLATE_PLACEHOLDER_GUARD;
    else if (v.unknown.length) errs[field] = `Unknown placeholder${v.unknown.length > 1 ? 's' : ''}: ${v.unknown.map((x) => `{${x}}`).join(', ')}.`;
  }
  return Object.keys(errs).length ? errs : null;
}

export async function saveNotificationTemplate(input: Input): Promise<ActionResult<{ template: NotificationTemplateDetail }>> {
  return runAction([...SA], saveNotificationTemplateSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const errs = guard(d.templateCode, d.subject, d.body);
    if (errs) return fail('Please correct the highlighted fields.', errs);
    const preview = await templatePreview(tx, d.templateCode, d.subject, d.body);
    if (pdpaIssues(preview).length) return fail('The text looks like it contains personal data (NRIC, account numbers or medical details).', { body: TEMPLATE_PLACEHOLDER_GUARD });
    await sql`insert into app.notification_templates (template_code, subject_override, body_override)
              values (${d.templateCode}, ${d.subject}, ${d.body})
              on conflict (template_code) do update set subject_override = excluded.subject_override, body_override = excluded.body_override`.execute(tx);
    return { template: (await templateDetailTx(tx, d.templateCode))! };
  }));
}

export async function resetNotificationTemplate(input: Input): Promise<ActionResult<{ template: NotificationTemplateDetail }>> {
  return runAction([...SA], templateCodeSchema, input, async ({ templateCode }, { ctx }) => withUserTx(ctx, async (tx) => {
    if (!TEMPLATE_BY_CODE[templateCode]) return fail('Unknown template.');
    await sql`delete from app.notification_templates where template_code = ${templateCode}`.execute(tx);
    return { template: (await templateDetailTx(tx, templateCode))! };
  }));
}

export async function previewNotificationTemplate(input: Input): Promise<ActionResult<{ preview: RenderedEmail }>> {
  return runAction(ADMIN, previewNotificationTemplateSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const errs = guard(d.templateCode, d.subject ?? '', d.body ?? '');
    if (errs) return fail('Please correct the highlighted fields.', errs);
    return { preview: await templatePreview(tx, d.templateCode, d.subject || null, d.body || null) };
  }));
}
