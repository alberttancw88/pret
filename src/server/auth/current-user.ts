import 'server-only';
import { cache } from 'react';
import { notFound, redirect } from 'next/navigation';
import { sql, withUserTx, type UserTxContext } from '../db';
import type { VerifiedClaims } from './claims';
import { getVerifiedSession } from './jwt';
import { requestMeta } from './request-context';
import { createSupabaseServerClient } from './supabase';

// Contract the Frontend relies on (W2-001). Roles are looked up LIVE in the database on
// every request (ADR-0001); the JWT contributes only sub, aal and session_id.

export type Role = 'SA' | 'ADM' | 'MGR' | 'EMP';

export type CurrentUser = {
  id: string;
  displayName: string;
  email: string;
  roles: Role[];
  isExternal: boolean;
  /** true at aal2 — or when the SA control setting does not require MFA for privileged roles. */
  mfaVerified: boolean;
  employeeNo: string | null;
  /** Extra (non-breaking): idle timeout for this user in minutes (15 ADM/SA, 30 others) — F-ADM-14. */
  idleTimeoutMin: number;
};

type ProfileRow = {
  app_user_id: string;
  display_name: string;
  login_email: string;
  user_type: 'employee' | 'external';
  employee_id: string | null;
  employee_no: string | null;
  roles: string[] | null;
  aal: string;
  mfa_required: boolean;
  mfa_enrolled: boolean;
};

type Resolved = { user: CurrentUser; claims: VerifiedClaims; accessToken: string; ctx: UserTxContext } | null;

const ROLE_ORDER: Role[] = ['SA', 'ADM', 'MGR', 'EMP'];

/**
 * Per-request resolution (memoised with React cache): verifies the session, enforces the
 * per-role idle timeout via app.touch_session(), and reads the profile and live roles.
 * Returns null when signed out, disabled/expired/outside the access window, or idle-timed-out.
 */
const resolveCurrentUser = cache(async (): Promise<Resolved> => {
  const session = await getVerifiedSession();
  if (!session) return null;
  const meta = await requestMeta();
  const ctx: UserTxContext = {
    claims: session.claims,
    requestId: meta.requestId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
  const result = await withUserTx(ctx, async (tx) => {
    const touch = await sql<{ status: string; idle_timeout_min: number }>`
      select status, idle_timeout_min from app.touch_session(${meta.ip}::inet, ${meta.userAgent})`.execute(tx);
    const t = touch.rows[0];
    if (!t || t.status !== 'ok') return null;
    const prof = await sql<ProfileRow>`select * from app.current_user_profile()`.execute(tx);
    const p = prof.rows[0];
    return p ? { p, idle: t.idle_timeout_min } : null;
  });
  if (!result) return null;
  const { p, idle } = result;
  const roles = ROLE_ORDER.filter((r) => (p.roles ?? []).includes(r));
  return {
    claims: session.claims,
    accessToken: session.accessToken,
    ctx,
    user: {
      id: p.app_user_id,
      displayName: p.display_name,
      email: p.login_email,
      roles,
      isExternal: p.user_type === 'external',
      mfaVerified: !p.mfa_required || p.aal === 'aal2',
      employeeNo: p.employee_no,
      idleTimeoutMin: idle,
    },
  };
});

export async function getCurrentUser(): Promise<CurrentUser | null> {
  return (await resolveCurrentUser())?.user ?? null;
}

/**
 * Server-only: the verified session + transaction context of the current user, for Server
 * Actions and route handlers that then call withUserTx(ctx, …). Null when not signed in.
 */
export async function getUserContext(): Promise<{ user: CurrentUser; ctx: UserTxContext; accessToken: string } | null> {
  const r = await resolveCurrentUser();
  return r ? { user: r.user, ctx: r.ctx, accessToken: r.accessToken } : null;
}

async function hasEnrolledFactor(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    return data?.nextLevel === 'aal2';
  } catch {
    return false;
  }
}

/**
 * Redirects to /login when signed out; privileged users (ADM/SA) without aal2 go to
 * /mfa?mode=enrol (no factor yet) or /mfa (enrolled). When `roles` is given and the user
 * holds none of them, renders Not Found ("Not found or no access" — EC-PRT-03).
 */
export async function requireUser(roles?: Role[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const privileged = user.roles.includes('SA') || user.roles.includes('ADM');
  if (privileged && !user.mfaVerified) {
    redirect((await hasEnrolledFactor()) ? '/mfa' : '/mfa?mode=enrol');
  }
  if (roles && roles.length > 0 && !roles.some((r) => user.roles.includes(r))) notFound();
  return user;
}
