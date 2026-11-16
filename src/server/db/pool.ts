import 'server-only';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { env } from '../env';

// The ONLY place that creates database connections (system-design §1 rule 3).
// Application code must use withUserTx / withJobTx from ./index — never import this file.
//
// Supavisor transaction mode (ADR-0002): pg never names its prepared statements unless
// asked to (we never pass `name`), so every query uses the unnamed statement — safe with
// transaction pooling. All per-request state is SET LOCAL / set_config(..., true).

// Plain dates stay strings ('yyyy-mm-dd'), never JS Date (non-functional §1).
pg.types.setTypeParser(1082, (v: string) => v);
// numeric stays a string (pg default) — money is never a JS float (ADR-0006).

function caCert(): string | undefined {
  const file = env.databaseCaCertFile();
  if (file) return readFileSync(file, 'utf8');
  const raw = env.databaseCaCert();
  if (!raw) return undefined;
  if (raw.includes('-----BEGIN CERTIFICATE-----')) return raw.replace(/\\n/g, '\n');
  return Buffer.from(raw, 'base64').toString('utf8');
}

function connectionString(url: string): string {
  // sslmode in the URL would override the explicit ssl options below.
  const u = new URL(url);
  u.searchParams.delete('sslmode');
  u.searchParams.delete('sslrootcert');
  return u.toString();
}

function makePool(url: string, max: number): pg.Pool {
  const ca = caCert();
  if (!ca) {
    // Supabase's pooler certificate chains to Supabase's own root CA, so system CAs cannot
    // verify it. We never fall back to unverified TLS.
    throw new Error(
      'PRET configuration error: DATABASE_CA_CERT or DATABASE_CA_CERT_FILE must hold the Supabase root CA ' +
        '(Dashboard → Project Settings → Database → SSL Configuration → Download certificate).',
    );
  }
  const pool = new pg.Pool({
    connectionString: connectionString(url),
    ssl: { ca, rejectUnauthorized: true },
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'pret',
  });
  pool.on('error', () => {
    // Idle-client errors (pooler restarts) must not crash the server; the next query reconnects.
  });
  return pool;
}

const globalForPools = globalThis as unknown as { __pretUserPool?: pg.Pool; __pretJobPool?: pg.Pool };

export function userPool(): pg.Pool {
  globalForPools.__pretUserPool ??= makePool(env.databaseUrl(), 5);
  return globalForPools.__pretUserPool;
}

export function jobPool(): pg.Pool {
  const jobsUrl = env.jobsDatabaseUrl();
  if (jobsUrl === env.databaseUrl()) return userPool();
  globalForPools.__pretJobPool ??= makePool(jobsUrl, 3);
  return globalForPools.__pretJobPool;
}
