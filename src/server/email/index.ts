import 'server-only';
import { headers } from 'next/headers';
import { Resend } from 'resend';
import { env } from '../env';

// Direct transactional send, used ONLY where the message carries a secret that must never be
// stored (the invitation link — ADR-0014: the token exists only in the email). Every other
// notification goes through app.notify → email_outbox (ADR-0010).
// Without RESEND_API_KEY + PRET_EMAIL_FROM nothing is sent and { sent: false } is returned.

export type SendResult = { sent: boolean; reason?: 'not_configured' | 'provider_error' };

export function emailConfigured(): boolean {
  return !!env.resendApiKey() && !!env.emailFrom();
}

export async function sendDirectEmail(msg: { to: string; subject: string; text: string; html: string }): Promise<SendResult> {
  const key = env.resendApiKey();
  const from = env.emailFrom();
  if (!key || !from) return { sent: false, reason: 'not_configured' };
  try {
    const { error } = await new Resend(key).emails.send({ from, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return error ? { sent: false, reason: 'provider_error' } : { sent: true };
  } catch {
    return { sent: false, reason: 'provider_error' };
  }
}

/** Public origin for links in emails (PRET_APP_URL, else the request host). */
export async function appOrigin(): Promise<string> {
  const configured = env.appUrl();
  if (configured) return configured.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** N-50 invitation email. Contains no personal data beyond the recipient's display name. */
export function invitationEmail(p: { displayName: string; acceptUrl: string; expiresText: string; companyName: string }) {
  const subject = `You're invited to PRET — ${p.companyName}`;
  const text = `Hello ${p.displayName},\n\nYou have been invited to PRET, ${p.companyName}'s HR system.\n` +
    `Set your password here: ${p.acceptUrl}\n\nThis link expires on ${p.expiresText} (Malaysia time). ` +
    `If it has expired, ask your administrator to re-send the invitation.\n`;
  const html = `<p>Hello ${esc(p.displayName)},</p><p>You have been invited to PRET, ${esc(p.companyName)}'s HR system.</p>` +
    `<p><a href="${esc(p.acceptUrl)}">Set your password</a></p>` +
    `<p>This link expires on ${esc(p.expiresText)} (Malaysia time). If it has expired, ask your administrator to re-send the invitation.</p>`;
  return { subject, text, html };
}
