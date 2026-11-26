import 'server-only';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { authorize, resolveNames } from '../lib/action-helpers';
import { parseParams } from './org';
import { deliveryConfig } from '../email/dispatch';
import {
  EMAIL_TEMPLATES, PLACEHOLDER_INFO, TEMPLATE_BY_CODE, allowedPlaceholders, renderEmail, samplePayload,
} from '../lib/email-templates';
import { MANDATORY_EMAIL_EVENT_CODES } from '../contracts/portal';
import {
  notificationLogParamsSchema, notificationTemplateListParamsSchema, NOTIFICATION_EVENTS, NOTIFICATION_EVENT_NAMES,
  type DeliveryStatus, type EmailDeliveryStatus, type NotificationChannel, type NotificationLogPage, type NotificationLogParams,
  type NotificationLogRow, type NotificationTemplateDetail, type NotificationTemplateListParams, type NotificationTemplateRow, type RenderedEmail,
} from '../contracts/notifications';

// M8 notification queries (W2-007): A15 log, delivery status, A16 templates. ADM / SA only (page requireUser, here, and the
// definer functions re-check app.is_admin()).

export const ADMIN: Role[] = ['ADM', 'SA'];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const iso = (v: Date | string | null | undefined) => (v == null ? null : (v instanceof Date ? v : new Date(v)).toISOString());

export function logRowOf(r: R): NotificationLogRow {
  const status = r.status as DeliveryStatus;
  return {
    id: r.id, channel: r.channel as NotificationChannel, at: iso(r.at)!, createdAt: iso(r.created_at)!,
    eventCode: r.event_code ?? null, eventName: r.event_code ? NOTIFICATION_EVENT_NAMES[r.event_code] ?? null : null,
    templateCode: r.template_code ?? null, recipientName: r.recipient_name ?? null, recipientEmail: r.recipient_email ?? null,
    status, attempts: Number(r.attempts ?? 0), statusDetail: r.status_detail ?? null, summary: r.summary ?? '',
    link: typeof r.link === 'string' && /^\/(?!\/)/.test(r.link) ? r.link : null,
    canRetry: r.channel === 'email' && (status === 'failed' || status === 'retrying'),
  };
}

export async function logRows(tx: Tx, params: NotificationLogParams, all: boolean) {
  const p = parseParams(notificationLogParamsSchema, params);
  const limit = all ? 10_000 : p.pageSize; const offset = all ? 0 : (p.page - 1) * p.pageSize;
  const rows = (await sql<R>`select * from app.notification_log(${p.q ?? null}, ${p.eventCodes?.length ? p.eventCodes : null}::text[],
      ${p.channels?.length ? p.channels : null}::text[], ${p.statuses?.length ? p.statuses : null}::text[], ${p.from ?? null}::date, ${p.to ?? null}::date,
      ${p.sort}, ${p.dir}, ${limit}, ${offset})`.execute(tx)).rows;
  let total = rows.length ? Number(rows[0]!.total_count) : 0;
  if (!rows.length && offset > 0) {
    total = Number((await sql<{ n: string }>`select coalesce(max(total_count), 0) as n from app.notification_log(${p.q ?? null}, ${p.eventCodes?.length ? p.eventCodes : null}::text[],
      ${p.channels?.length ? p.channels : null}::text[], ${p.statuses?.length ? p.statuses : null}::text[], ${p.from ?? null}::date, ${p.to ?? null}::date,
      ${p.sort}, ${p.dir}, 1, 0)`.execute(tx)).rows[0]?.n ?? 0);
  }
  return { rows: rows.map(logRowOf), total, page: all ? 1 : p.page, pageSize: all ? limit : p.pageSize };
}

export async function deliveryStatusTx(tx: Tx): Promise<EmailDeliveryStatus> {
  const cfg = deliveryConfig();
  const c = (await sql<R>`select * from app.email_delivery_counts()`.execute(tx)).rows[0] ?? {};
  const domains = (await sql<{ d: string }>`select unnest(st.allowed_email_domains)::text as d from app.security_settings st where st.id = 1`.execute(tx)).rows.map((x) => x.d);
  const queued = Number(c.queued ?? 0);
  const message = !cfg.configured
    ? `Email is not configured (${cfg.reason?.replace('not configured: ', '')}). ${queued} email(s) are queued and will be sent once it is set up; emails not sent within 72 hours are dropped.`
    : cfg.mode === 'restricted'
      ? `Restricted delivery: only addresses on ${domains.join(', ') || 'the allowed domains'} (or the test recipients) are emailed; others are suppressed. Set PRET_EMAIL_DELIVERY=live in production.`
      : 'Email delivery is live.';
  return {
    configured: cfg.configured, mode: cfg.mode, message, queued, retrying: Number(c.retrying ?? 0), failed: Number(c.failed ?? 0),
    sentLast24h: Number(c.sent_last_24h ?? 0), oldestQueuedAt: iso(c.oldest_queued_at), lastSentAt: iso(c.last_sent_at), allowedDomains: domains,
  };
}

export async function listNotificationLog(params: NotificationLogParams): Promise<NotificationLogPage> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, async (tx) => ({ ...(await logRows(tx, params, false)), delivery: await deliveryStatusTx(tx) }));
}

export async function getEmailDeliveryStatus(): Promise<EmailDeliveryStatus> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, deliveryStatusTx);
}

// ===========================================================================
// A16 templates
// ===========================================================================
type OverrideRow = { template_code: string; subject_override: string | null; body_override: string | null; updated_by: string | null; updated_at: Date | null };

async function overrides(tx: Tx): Promise<Map<string, OverrideRow>> {
  const rows = (await sql<OverrideRow>`select template_code, subject_override, body_override, updated_by, updated_at from app.notification_templates`.execute(tx)).rows;
  return new Map(rows.map((r) => [r.template_code, r]));
}

function rowOf(code: string, o: OverrideRow | undefined, names: Map<string, string>, isSa: boolean): NotificationTemplateRow {
  const def = TEMPLATE_BY_CODE[code]!;
  const ev = NOTIFICATION_EVENTS.find((e) => e.code === def.eventCode);
  return {
    templateCode: code, eventCode: def.eventCode, eventName: ev?.name ?? def.eventCode, recipients: ev?.recipients ?? '', email: true,
    inApp: ev?.inApp ?? true, mandatory: MANDATORY_EMAIL_EVENT_CODES.includes(def.eventCode), editable: isSa,
    overridden: !!(o && (o.subject_override || o.body_override)),
    updatedAt: o?.updated_at ? o.updated_at.toISOString() : null, updatedByName: o?.updated_by ? names.get(o.updated_by) ?? null : null,
  };
}

async function isSa(tx: Tx): Promise<boolean> {
  return (await sql<{ s: boolean }>`select app.is_sa() as s`.execute(tx)).rows[0]?.s ?? false;
}

export async function templateRowsTx(tx: Tx, params?: NotificationTemplateListParams): Promise<NotificationTemplateRow[]> {
  const p = parseParams(notificationTemplateListParamsSchema, params ?? {});
  const ov = await overrides(tx);
  const names = await resolveNames(tx, [...ov.values()].map((o) => o.updated_by));
  const sa = await isSa(tx);
  const q = p.q?.toLowerCase();
  return EMAIL_TEMPLATES.map((t) => rowOf(t.code, ov.get(t.code), names, sa))
    .filter((r) => (!p.overriddenOnly || r.overridden)
      && (!q || [r.templateCode, r.eventCode, r.eventName, r.recipients].some((s) => s.toLowerCase().includes(q))))
    .sort((a, b) => a.eventCode.localeCompare(b.eventCode) || a.templateCode.localeCompare(b.templateCode));
}

export async function templatePreview(tx: Tx, code: string, subject?: string | null, body?: string | null): Promise<RenderedEmail> {
  const company = (await sql<{ n: string | null }>`select legal_name as n from app.company_profile where id = 1`.execute(tx)).rows[0]?.n ?? 'Interact Technology Sdn Bhd';
  const def = TEMPLATE_BY_CODE[code]!;
  return renderEmail({
    templateCode: code, title: PLACEHOLDER_INFO.title!.sample, payload: samplePayload(code), link: `https://pret.example.invalid${def.defaultLink}`,
    origin: 'https://pret.example.invalid', companyName: company, recipientName: PLACEHOLDER_INFO.recipient_name!.sample,
    override: { subject: subject ?? null, body: body ?? null },
  });
}

export async function templateDetailTx(tx: Tx, code: string): Promise<NotificationTemplateDetail | null> {
  const def = TEMPLATE_BY_CODE[code];
  if (!def) return null;
  const ov = await overrides(tx);
  const o = ov.get(code);
  const names = await resolveNames(tx, [o?.updated_by]);
  const row = rowOf(code, o, names, await isSa(tx));
  const subject = o?.subject_override ?? def.subject;
  const body = o?.body_override ?? def.body;
  return {
    ...row,
    placeholders: allowedPlaceholders(def).map((k) => ({ key: k, label: PLACEHOLDER_INFO[k]?.label ?? k, sample: PLACEHOLDER_INFO[k]?.sample ?? '' })),
    defaultSubject: def.subject, defaultBody: def.body, subject, body,
    preview: await templatePreview(tx, code, o?.subject_override, o?.body_override),
  };
}

export async function listNotificationTemplates(params?: NotificationTemplateListParams): Promise<NotificationTemplateRow[]> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => templateRowsTx(tx, params));
}

export async function getNotificationTemplate(templateCode: string): Promise<NotificationTemplateDetail | null> {
  const { ctx } = await authorize(ADMIN);
  return withUserTx(ctx, (tx) => templateDetailTx(tx, templateCode));
}
