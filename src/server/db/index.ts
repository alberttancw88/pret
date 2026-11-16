import 'server-only';
import { Kysely, PostgresDialect, sql, type Transaction } from 'kysely';
import type { VerifiedClaims } from '../auth/claims';
import { jobPool, userPool } from './pool';
import type { DB } from './types';

export type { DB } from './types';
export type Tx = Transaction<DB>;

// ---------------------------------------------------------------------------
// The two database handles (system-design §1 rule 3, ADR-0002, rls-policies §2).
// ---------------------------------------------------------------------------

let userDb: Kysely<DB> | undefined;
let jobDb: Kysely<DB> | undefined;

function getUserDb(): Kysely<DB> {
  userDb ??= new Kysely<DB>({ dialect: new PostgresDialect({ pool: userPool() }) });
  return userDb;
}
function getJobDb(): Kysely<DB> {
  jobDb ??= new Kysely<DB>({ dialect: new PostgresDialect({ pool: jobPool() }) });
  return jobDb;
}

export interface UserTxContext {
  /** Claims of a JWKS-verified access token (src/server/auth/jwt.ts). Never client-supplied. */
  claims: VerifiedClaims;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** Reason for a reveal / override / adjustment (audit AU8). */
  reason?: string | null;
  /** FR-G-17 on-behalf actions. */
  onBehalfEmployeeId?: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Run `fn` in one transaction impersonating the signed-in user:
 * `SET LOCAL ROLE authenticated` + verified claims, so auth.uid(), the RLS helpers and every
 * policy behave exactly as designed. Everything is transaction-local (pooler-safe).
 */
export async function withUserTx<T>(ctx: UserTxContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const claims = ctx.claims;
  if (!claims || typeof claims.sub !== 'string' || !UUID_RE.test(claims.sub)) {
    throw new Error('PRET-AUTH-CLAIMS: withUserTx requires verified claims');
  }
  return getUserDb()
    .transaction()
    .execute(async (tx) => {
      await sql`set local statement_timeout = '15s'`.execute(tx);
      await sql`set local role authenticated`.execute(tx);
      await sql`select
          set_config('request.jwt.claims', ${JSON.stringify({ ...claims, role: 'authenticated' })}, true),
          set_config('request.jwt.claim.sub', ${claims.sub}, true),
          set_config('request.jwt.claim.role', 'authenticated', true),
          set_config('app.request_id', ${ctx.requestId && UUID_RE.test(ctx.requestId) ? ctx.requestId : ''}, true),
          set_config('app.client_ip', ${ctx.ip ?? ''}, true),
          set_config('app.user_agent', ${(ctx.userAgent ?? '').slice(0, 500)}, true),
          set_config('app.reason', ${(ctx.reason ?? '').slice(0, 1000)}, true),
          set_config('app.on_behalf_employee_id', ${ctx.onBehalfEmployeeId && UUID_RE.test(ctx.onBehalfEmployeeId) ? ctx.onBehalfEmployeeId : ''}, true),
          set_config('app.actor_label', '', true)`.execute(tx);
      return fn(tx);
    });
}

/**
 * Run `fn` as the system (scheduled jobs, sign-in bookkeeping, invite acceptance):
 * `SET LOCAL ROLE service_role` (BYPASSRLS) with `app.actor_label = 'system:<job>'`
 * for the audit log. Never used to serve an interactive user's data request.
 */
export async function withJobTx<T>(jobName: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!/^[a-z0-9][a-z0-9:_-]{0,63}$/.test(jobName)) {
    throw new Error('PRET-JOB-NAME: invalid job name');
  }
  return getJobDb()
    .transaction()
    .execute(async (tx) => {
      await sql`set local statement_timeout = '300s'`.execute(tx);
      await sql`set local role service_role`.execute(tx);
      await sql`select
          set_config('request.jwt.claims', '', true),
          set_config('request.jwt.claim.sub', '', true),
          set_config('app.actor_label', ${'system:' + jobName}, true)`.execute(tx);
      return fn(tx);
    });
}

// ---------------------------------------------------------------------------
// Database error mapping: PRET-* codes raised by triggers/functions → stable codes
// the UI can map to field messages (FR-G-07). Access failures read "Not found or no access".
// ---------------------------------------------------------------------------
export interface PretDbError {
  code: string;
  message: string;
  sqlState?: string;
}

export function toPretError(err: unknown): PretDbError {
  const e = err as { message?: string; code?: string };
  const msg = typeof e?.message === 'string' ? e.message : '';
  const m = msg.match(/PRET-[A-Z0-9-]+/);
  if (m) return { code: m[0], message: msg.replace(/^.*?(PRET-[A-Z0-9-]+):?\s*/, '').trim() || m[0], sqlState: e.code };
  if (e?.code === '42501') return { code: 'PRET-ACC-403', message: 'Not found or no access', sqlState: e.code };
  if (e?.code === '23505') return { code: 'PRET-DUPLICATE', message: 'This record already exists', sqlState: e.code };
  if (e?.code === '40001' || e?.code === '40P01')
    return { code: 'PRET-RETRY', message: 'Please try again', sqlState: e.code };
  return { code: 'PRET-DB', message: 'Something went wrong. Please try again.', sqlState: e?.code };
}

export { sql };
