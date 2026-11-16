import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { sql, withUserTx, type UserTxContext } from '../db';

// PRET's own 72-hour invitations (ADR-0014). The token exists only in the email; the
// database keeps its SHA-256. app.create_invitation() re-checks the caller (SA, or ADM for
// employee users without privileged roles) and revokes earlier open invitations.

export function hashInviteToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url'); // 43 chars
}

/**
 * Issues an invitation for an `invited` app user. Returns the token and accept URL for the
 * invitation email — the caller sends it (W2-002) and must never log or store the token.
 */
export async function issueInvitation(
  ctx: UserTxContext,
  userId: string,
  opts: { scheduledSendAt?: Date | null; appUrl: string },
) {
  const token = newInviteToken();
  const invitationId = await withUserTx(ctx, async (tx) => {
    const r = await sql<{ id: string }>`
      select app.create_invitation(
        ${userId}::uuid, ${hashInviteToken(token)},
        coalesce(${opts.scheduledSendAt ?? null}::timestamptz, now())
          + make_interval(hours => coalesce((select st.invite_link_hours from app.security_settings st where st.id = 1), 72)),
        ${opts.scheduledSendAt ?? null}::timestamptz) as id`.execute(tx);
    return r.rows[0]!.id;
  });
  const acceptUrl = `${opts.appUrl.replace(/\/+$/, '')}/accept-invite?token=${encodeURIComponent(token)}`;
  return { invitationId, token, acceptUrl };
}
