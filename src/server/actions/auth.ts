'use server';

// Auth Server Actions (W2-001, ADR-0014). Called by the auth screens with plain objects
// (FormData also accepted). Every action zod-validates its input and returns
//   { ok: true, ... } | { ok: false, error, fieldErrors? }
// Messages are generic where a specific one would reveal whether an account exists.
// Navigation is done by the client (it goes to "/" which routes by role / MFA state).

import { headers } from 'next/headers';
import { z } from 'zod';
import { sql, withJobTx, withUserTx, type Tx } from '../db';
import { getUserContext } from '../auth/current-user';
import { hashInviteToken } from '../auth/invitations';
import { getVerifiedSession, verifyAccessToken } from '../auth/jwt';
import { emailSchema, inviteTokenSchema, passwordSchema, totpCodeSchema, uuidSchema } from '../auth/policy';
import { requestMeta } from '../auth/request-context';
import { createSupabaseAdminClient, createSupabaseServerClient } from '../auth/supabase';
import { env } from '../env';

export type ActionOk<T extends object = object> = { ok: true } & T;
export type ActionFail = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ActionResult<T extends object = object> = ActionOk<T> | ActionFail;

const GENERIC_SIGNIN = 'Email or password is incorrect.';
const LOCKED = 'Too many unsuccessful attempts. Your account is locked for a while — try again later or contact your administrator.';
const RATE_LIMITED = 'Too many attempts. Please wait a few minutes and try again.';
const UNEXPECTED = 'Something went wrong. Please try again.';
const INVITE_INVALID = 'This invitation link is invalid or has expired.';

type Input = FormData | Record<string, unknown> | undefined | null;

function toObject(input: Input): Record<string, unknown> {
  if (!input) return {};
  if (typeof FormData !== 'undefined' && input instanceof FormData) return Object.fromEntries(input.entries());
  return input as Record<string, unknown>;
}

function fail(error: string, fieldErrors?: Record<string, string>): ActionFail {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

function invalid(err: z.ZodError): ActionFail {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? 'form');
    fieldErrors[key] ??= issue.message;
  }
  return fail('Please correct the highlighted fields.', fieldErrors);
}

async function rateLimited(tx: Tx, key: string, windowSeconds: number, max: number): Promise<boolean> {
  const r = await sql<{ ok: boolean }>`select private.rate_limit_hit(${key}, ${windowSeconds}::int, ${max}::int) as ok`.execute(tx);
  return r.rows[0]?.ok === false;
}

async function appOrigin(): Promise<string> {
  const configured = env.appUrl();
  if (configured) return configured.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

type LoginUserRow = {
  id: string;
  status: string;
  locked_until: Date | null;
  failed_login_count: number;
  window_ok: boolean;
  lockout_threshold: number;
  lockout_minutes: number;
};

async function recordLogin(
  tx: Tx,
  email: string,
  userId: string | null,
  outcome: 'success' | 'failure' | 'locked' | 'mfa_failure' | 'disabled' | 'expired',
  meta: { ip: string | null; userAgent: string | null },
  detail?: string,
) {
  await sql`insert into app.login_events (login_email, user_id, outcome, ip, user_agent, detail)
            values (${email}, ${userId}::uuid, ${outcome}::app.login_outcome, ${meta.ip}::inet, ${meta.userAgent}, ${detail ?? null})`.execute(tx);
}

// ---------------------------------------------------------------------------
// signIn — lockout after N failures (F-ADM-13), login_events, app_sessions row.
// ---------------------------------------------------------------------------
const signInSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.').max(200),
});

export async function signIn(input: Input): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const { email, password } = parsed.data;
  try {
    const meta = await requestMeta();

    const pre = await withJobTx('auth-signin', async (tx) => {
      if (meta.ip && (await rateLimited(tx, `signin:ip:${meta.ip}`, 300, 30))) return 'rate' as const;
      if (await rateLimited(tx, `signin:email:${email}`, 300, 10)) return 'rate' as const;
      const r = await sql<LoginUserRow>`
        select u.id, u.status::text, u.locked_until, u.failed_login_count,
               (u.access_start_date <= app.today_myt() and (u.access_end_date is null or u.access_end_date >= app.today_myt())) as window_ok,
               coalesce(s.lockout_threshold, 5) as lockout_threshold, coalesce(s.lockout_minutes, 30) as lockout_minutes
          from app.app_users u left join app.security_settings s on s.id = 1
         where u.login_email = ${email}`.execute(tx);
      const user = r.rows[0] ?? null;
      if (user?.locked_until && user.locked_until.getTime() > Date.now()) {
        await recordLogin(tx, email, user.id, 'locked', meta, 'attempt while locked');
        return 'locked' as const;
      }
      return user;
    });
    if (pre === 'rate') return fail(RATE_LIMITED);
    if (pre === 'locked') return fail(LOCKED);
    const user = pre;

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      const nowLocked = await withJobTx('auth-signin', async (tx) => {
        if (!user) {
          await recordLogin(tx, email, null, 'failure', meta, 'unknown account');
          return false;
        }
        const count = user.failed_login_count + 1;
        const lock = count >= user.lockout_threshold;
        await sql`update app.app_users
                     set failed_login_count = ${lock ? 0 : count},
                         locked_until = ${lock ? sql`now() + make_interval(mins => ${user.lockout_minutes}::int)` : sql`locked_until`}
                   where id = ${user.id}::uuid`.execute(tx);
        await recordLogin(tx, email, user.id, lock ? 'locked' : 'failure', meta);
        if (lock) {
          // N-52 to the user and every active Super Admin (in-app + email outbox; no sensitive data).
          await sql`select app.notify(${user.id}::uuid, 'N-52', 'Your PRET account was locked after repeated sign-in failures',
                                      null, '/login', false, 'account_locked', '{}'::jsonb)`.execute(tx);
          await sql`select app.notify(r.user_id, 'N-52', 'A PRET account was locked after repeated sign-in failures',
                                      null, '/admin/users', false, 'account_locked_admin', jsonb_build_object('user_id', ${user.id}::text))
                      from app.user_roles r join app.app_users u on u.id = r.user_id
                     where r.role = 'SA' and r.revoked_at is null and u.status = 'active'`.execute(tx);
        }
        return lock;
      });
      return fail(nowLocked ? LOCKED : GENERIC_SIGNIN);
    }

    // Authenticated with Supabase — PRET decides whether this account may use the system.
    const claims = await verifyAccessToken(data.session.access_token);
    const usable = !!user && !!claims && user.status === 'active' && user.window_ok;
    await withJobTx('auth-signin', async (tx) => {
      if (!usable) {
        const outcome = user && !user.window_ok ? 'expired' : 'disabled';
        await recordLogin(tx, email, user?.id ?? null, outcome, meta, 'authenticated but not an active PRET user');
        return;
      }
      await sql`update app.app_users set failed_login_count = 0, locked_until = null, last_login_at = now()
                 where id = ${user!.id}::uuid`.execute(tx);
      await recordLogin(tx, email, user!.id, 'success', meta);
      const sid = typeof claims!.session_id === 'string' ? claims!.session_id : null;
      if (sid) {
        await sql`insert into app.app_sessions (session_id, user_id, aal, ip, user_agent)
                  values (${sid}::uuid, ${user!.id}::uuid, ${String(claims!.aal ?? 'aal1')}, ${meta.ip}::inet, ${meta.userAgent})
                  on conflict (session_id) do nothing`.execute(tx);
      }
    });
    if (!usable) {
      await supabase.auth.signOut({ scope: 'local' });
      return fail(GENERIC_SIGNIN);
    }
    return { ok: true };
  } catch {
    return fail(UNEXPECTED);
  }
}

// ---------------------------------------------------------------------------
// MFA (F-ADM-07): TOTP enrolment and verification → aal2.
// ---------------------------------------------------------------------------
export async function enrollMfa(): Promise<ActionResult<{ factorId: string; qrCode: string; secret: string }>> {
  try {
    const ctx = await getUserContext();
    if (!ctx) return fail('Your session has ended. Please sign in again.');
    const supabase = await createSupabaseServerClient();
    const factors = await supabase.auth.mfa.listFactors();
    if (factors.error) return fail(UNEXPECTED);
    if (factors.data.totp.some((f) => f.status === 'verified')) {
      return fail('Two-factor authentication is already set up for this account.');
    }
    // Remove abandoned, unverified enrolments so a fresh QR code can be issued.
    for (const f of factors.data.all) {
      if (f.factor_type === 'totp' && f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PRET', issuer: 'PRET' });
    if (error || !data || data.type !== 'totp') return fail("Couldn't start two-factor set-up. Please try again.");
    return { ok: true, factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
  } catch {
    return fail(UNEXPECTED);
  }
}

const verifyMfaSchema = z.object({ code: totpCodeSchema, factorId: uuidSchema.optional() });

export async function verifyMfa(input: Input): Promise<ActionResult> {
  const raw = toObject(input);
  const parsed = verifyMfaSchema.safeParse({ ...raw, factorId: raw.factorId ? raw.factorId : undefined });
  if (!parsed.success) return invalid(parsed.error);
  try {
    const session = await getVerifiedSession();
    if (!session) return fail('Your session has ended. Please sign in again.');
    const meta = await requestMeta();
    const limited = await withJobTx('auth-mfa', (tx) => rateLimited(tx, `mfa:${session.claims.sub}`, 300, 10));
    if (limited) return fail(RATE_LIMITED);

    const supabase = await createSupabaseServerClient();
    let factorId = parsed.data.factorId;
    if (!factorId) {
      const factors = await supabase.auth.mfa.listFactors();
      factorId = factors.data?.totp.find((f) => f.status === 'verified')?.id;
      if (!factorId) return fail('Set up two-factor authentication first.', { code: 'Set up two-factor authentication first.' });
    }
    const { data, error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: parsed.data.code });
    if (error || !data) {
      await withJobTx('auth-mfa', async (tx) => {
        const u = await sql<{ id: string; login_email: string }>`
          select id, login_email::text from app.app_users where auth_user_id = ${session.claims.sub}::uuid`.execute(tx);
        const row = u.rows[0];
        if (row) await recordLogin(tx, row.login_email, row.id, 'mfa_failure', meta);
      });
      return fail('Code is incorrect or expired.', { code: 'Code is incorrect or expired.' });
    }
    const claims = await verifyAccessToken(data.access_token);
    await withJobTx('auth-mfa', async (tx) => {
      await sql`update app.app_users set mfa_enrolled = true where auth_user_id = ${session.claims.sub}::uuid and not mfa_enrolled`.execute(tx);
      if (claims?.session_id) {
        await sql`update app.app_sessions set aal = ${String(claims.aal ?? 'aal2')}, last_seen_at = now()
                   where session_id = ${String(claims.session_id)}::uuid and ended_at is null`.execute(tx);
      }
    });
    return { ok: true };
  } catch {
    return fail(UNEXPECTED);
  }
}

// ---------------------------------------------------------------------------
// Invitations (ADR-0014): accept → create the Auth user with the chosen password, link it,
// activate the PRET user, sign in.
// ---------------------------------------------------------------------------
const acceptInviteSchema = z.object({ token: inviteTokenSchema, password: passwordSchema });

export async function acceptInvite(input: Input): Promise<ActionResult> {
  const parsed = acceptInviteSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const { token, password } = parsed.data;
  try {
    const meta = await requestMeta();
    const admin = createSupabaseAdminClient();
    if (!admin) return fail('Invitations are not available yet. Please contact your administrator.');

    const invite = await withJobTx('auth-invite', async (tx) => {
      if (meta.ip && (await rateLimited(tx, `invite:ip:${meta.ip}`, 900, 20))) return 'rate' as const;
      const r = await sql<{ invitation_id: string; user_id: string; login_email: string }>`
        select i.id as invitation_id, u.id as user_id, u.login_email::text as login_email
          from app.user_invitations i join app.app_users u on u.id = i.user_id
         where i.token_hash = ${hashInviteToken(token)}
           and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
           and (i.scheduled_send_at is null or i.scheduled_send_at <= now())
           and u.status = 'invited' and u.auth_user_id is null
           and (u.access_end_date is null or u.access_end_date >= app.today_myt())`.execute(tx);
      return r.rows[0] ?? null;
    });
    if (invite === 'rate') return fail(RATE_LIMITED);
    if (!invite) return fail(INVITE_INVALID, { token: INVITE_INVALID });

    const created = await admin.auth.admin.createUser({ email: invite.login_email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      const msg = created.error?.message ?? '';
      if (/password/i.test(msg)) {
        const m = 'This password is too weak or has appeared in a data breach. Choose another.';
        return fail(m, { password: m });
      }
      return fail(UNEXPECTED);
    }
    const authUserId = created.data.user.id;
    try {
      await withJobTx('auth-invite', async (tx) => {
        const upd = await sql`update app.user_invitations set accepted_at = now()
                               where id = ${invite.invitation_id}::uuid and accepted_at is null and revoked_at is null`.execute(tx);
        if (Number(upd.numAffectedRows ?? 0) !== 1) throw new Error('PRET-INV-STATE');
        await sql`update app.app_users set auth_user_id = ${authUserId}::uuid, status = 'active'
                   where id = ${invite.user_id}::uuid and status = 'invited' and auth_user_id is null`.execute(tx);
      });
    } catch {
      await admin.auth.admin.deleteUser(authUserId); // compensate: no orphan Auth user
      return fail(INVITE_INVALID, { token: INVITE_INVALID });
    }

    return signIn({ email: invite.login_email, password });
  } catch {
    return fail(UNEXPECTED);
  }
}

// ---------------------------------------------------------------------------
// Password reset (BR-ADM-07): link valid 1 h (Supabase setting); same response either way.
// ---------------------------------------------------------------------------
const resetRequestSchema = z.object({ email: emailSchema });

export async function requestPasswordReset(input: Input): Promise<ActionResult> {
  const parsed = resetRequestSchema.safeParse(toObject(input));
  if (!parsed.success) return invalid(parsed.error);
  const { email } = parsed.data;
  try {
    const meta = await requestMeta();
    const send = await withJobTx('auth-reset', async (tx) => {
      if (meta.ip && (await rateLimited(tx, `reset:ip:${meta.ip}`, 900, 10))) return false;
      if (await rateLimited(tx, `reset:email:${email}`, 3600, 3)) return false;
      const r = await sql<{ ok: boolean }>`
        select exists (select 1 from app.app_users u where u.login_email = ${email} and u.status = 'active'
                          and u.auth_user_id is not null) as ok`.execute(tx);
      return r.rows[0]?.ok === true;
    });
    if (send) {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await appOrigin()}/reset-password` });
    }
  } catch {
    // Same response whatever happened (no account enumeration).
  }
  return { ok: true };
}

const completeResetSchema = z.object({ password: passwordSchema, code: z.string().trim().min(6).max(200).optional() });

/**
 * Sets the new password for the recovery session. `code` (optional) is the `?code=` from the
 * Supabase recovery link — exchanged here for the recovery session if the page has not done so.
 */
export async function completePasswordReset(input: Input): Promise<ActionResult> {
  const raw = toObject(input);
  const parsed = completeResetSchema.safeParse({ ...raw, code: raw.code ? raw.code : undefined });
  if (!parsed.success) return invalid(parsed.error);
  try {
    const supabase = await createSupabaseServerClient();
    if (parsed.data.code) {
      const ex = await supabase.auth.exchangeCodeForSession(parsed.data.code);
      if (ex.error) return fail('This reset link is invalid or has expired. Request a new one.');
    }
    const session = await getVerifiedSession();
    if (!session) return fail('This reset link is invalid or has expired. Request a new one.');
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) {
      const m = /password/i.test(error.message)
        ? 'This password is too weak, has appeared in a data breach, or matches your previous one. Choose another.'
        : UNEXPECTED;
      return fail(m, m === UNEXPECTED ? undefined : { password: m });
    }
    // End every other session of this user and clear lockout state.
    await supabase.auth.signOut({ scope: 'others' });
    await withJobTx('auth-reset', async (tx) => {
      await sql`update app.app_sessions s set ended_at = now(), end_reason = 'password_reset'
                 from app.app_users u
                where u.id = s.user_id and u.auth_user_id = ${session.claims.sub}::uuid and s.ended_at is null
                  and s.session_id::text is distinct from ${String(session.claims.session_id ?? '')}`.execute(tx);
      await sql`update app.app_users set failed_login_count = 0, locked_until = null
                 where auth_user_id = ${session.claims.sub}::uuid`.execute(tx);
    });
    return { ok: true };
  } catch {
    return fail(UNEXPECTED);
  }
}

// ---------------------------------------------------------------------------
// Sign-out and keep-alive
// ---------------------------------------------------------------------------
export async function signOut(): Promise<ActionResult> {
  try {
    const session = await getVerifiedSession();
    if (session) {
      const meta = await requestMeta();
      try {
        await withUserTx({ claims: session.claims, ...meta }, async (tx) => {
          await sql`select app.end_my_session('logout')`.execute(tx);
        });
      } catch {
        // still sign out of Supabase below
      }
    }
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: 'local' });
    return { ok: true };
  } catch {
    return fail(UNEXPECTED);
  }
}

/** Called by the idle-timeout warning ("Stay signed in") — refreshes last_seen_at. */
export async function keepAlive(): Promise<ActionResult<{ idleTimeoutMin: number }>> {
  const ctx = await getUserContext();
  if (!ctx) return fail('Your session has ended. Please sign in again.');
  return { ok: true, idleTimeoutMin: ctx.user.idleTimeoutMin };
}

