import 'server-only';
import { sql, withJobTx, type Tx } from '../db';
import { hashInviteToken, newInviteToken } from '../auth/invitations';
import { appOrigin, invitationEmail, sendDirectEmail } from '../email';
import { env } from '../env';
import { formatDateTime } from '../../lib/format/date';

// Invitation plumbing shared by A6/A7 (actions/users.ts), E2/E15 (actions/employees.ts) and the
// scheduled-invite job (jobs/scheduled-invites.ts). ADR-0014: the token exists only in the email.

export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000001';
export type IssuedInvitation = { token: string; invitationId: string; expiresAt: Date };

/** Interactive: app.create_invitation re-checks the caller (SA, or ADM for employee users without privileged roles). */
export async function createInvitation(tx: Tx, userId: string): Promise<IssuedInvitation> {
  const token = newInviteToken();
  const r = await sql<{ id: string }>`
    select app.create_invitation(${userId}::uuid, ${hashInviteToken(token)},
      now() + make_interval(hours => coalesce((select st.invite_link_hours from app.security_settings st where st.id = 1), 72)),
      null) as id`.execute(tx);
  const invitationId = r.rows[0]!.id;
  // separate statement: rows written by the function are not visible to the statement that called it
  const e = await sql<{ expires_at: Date }>`select expires_at from app.user_invitations where id = ${invitationId}::uuid`.execute(tx);
  return { token, invitationId, expiresAt: e.rows[0]!.expires_at };
}

export async function companyName(tx: Tx): Promise<string> {
  return (await sql<{ legal_name: string }>`select legal_name from app.company_profile where id = 1`.execute(tx)).rows[0]?.legal_name ?? 'Interact';
}

async function origin(): Promise<string> {
  const configured = env.appUrl();
  if (configured) return configured.replace(/\/+$/, '');
  try { return await appOrigin(); } catch { return 'http://localhost:3000'; }
}

export async function deliverInvitation(inv: IssuedInvitation, to: { email: string; displayName: string }, company: string): Promise<boolean> {
  const acceptUrl = `${await origin()}/accept-invite?token=${encodeURIComponent(inv.token)}`;
  const mail = invitationEmail({ displayName: to.displayName, acceptUrl, expiresText: formatDateTime(inv.expiresAt), companyName: company });
  const res = await sendDirectEmail({ to: to.email, ...mail });
  if (res.sent) {
    await withJobTx('invite-sent', async (tx) => {
      await sql`update app.user_invitations set sent_at = now() where id = ${inv.invitationId}::uuid and sent_at is null`.execute(tx);
    });
  }
  return res.sent;
}

export function inviteMessage(sent: boolean): string {
  return sent
    ? 'Invitation sent.'
    : 'The account was created but the invitation email could not be sent (email is not configured on the server yet). Use RESEND INVITE once email is set up.';
}

/**
 * Creates the employee user (Invited; login email = work email, BR-EMP-07) for an employee record.
 * Access starts on the join date (or today when already joined). scheduledFor: date the daily invite
 * job sends the email (null = the caller sends now). Runs under the caller's RLS (ADM may insert employee users).
 */
export async function createEmployeeUser(tx: Tx, employeeId: string, scheduledFor: string | null): Promise<{ userId: string; email: string; displayName: string }> {
  const e = (await sql<{ work_email: string; full_name: string; preferred_name: string | null; join_date: string; today: string }>`
    select work_email::text as work_email, full_name, preferred_name, join_date, app.today_myt()::text as today
      from app.employees where id = ${employeeId}::uuid`.execute(tx)).rows[0];
  if (!e) throw new Error('PRET-ACC-404');
  const displayName = (e.preferred_name ?? e.full_name).slice(0, 100);
  const start = e.join_date > e.today ? e.join_date : e.today;
  const r = await sql<{ id: string }>`
    insert into app.app_users (user_type, employee_id, login_email, display_name, access_start_date)
    values ('employee', ${employeeId}::uuid, ${e.work_email}, ${displayName}, ${start}::date) returning id`.execute(tx);
  const userId = r.rows[0]!.id;
  if (scheduledFor) await setInviteSchedule(tx, userId, scheduledFor);
  return { userId, email: e.work_email, displayName };
}

/** Schedules (date) or clears (null) the invitation email of a not-yet-accepted user — caller's RLS applies. */
export async function setInviteSchedule(tx: Tx, userId: string, date: string | null): Promise<void> {
  await sql`update app.app_users set invite_scheduled_for = ${date}::date
             where id = ${userId}::uuid and status = 'invited' and auth_user_id is null`.execute(tx);
}
