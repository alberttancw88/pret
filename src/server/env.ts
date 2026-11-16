import 'server-only';

// Server-only environment access. Values are never logged or returned to the client.

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`PRET configuration error: environment variable ${name} is not set`);
  }
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : undefined;
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabasePublishableKey: () => required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  /** Server-only secret key — needed for Auth admin calls (create user on invite, global sign-out). */
  supabaseSecretKey: () => optional('SUPABASE_SECRET_KEY'),
  /** Supavisor transaction pooler (port 6543), ADR-0002. Interactive requests. */
  databaseUrl: () => required('DATABASE_URL'),
  /** Optional separate login for scheduled jobs (pret_jobs). Falls back to DATABASE_URL. */
  jobsDatabaseUrl: () => optional('JOBS_DATABASE_URL') ?? required('DATABASE_URL'),
  /** Supabase root CA for verified TLS to the pooler: PEM text or base64 of the PEM. */
  databaseCaCert: () => optional('DATABASE_CA_CERT'),
  /** Alternative: path to the CA file (e.g. downloaded from Dashboard → Database → SSL). */
  databaseCaCertFile: () => optional('DATABASE_CA_CERT_FILE'),
  appUrl: () => optional('PRET_APP_URL'),
  /** Transactional email (Resend). When absent, emails are not sent and callers degrade gracefully (W2-002). */
  resendApiKey: () => optional('RESEND_API_KEY'),
  /** Sender, e.g. 'PRET <no-reply@example.com>'. Required together with RESEND_API_KEY. */
  emailFrom: () => optional('PRET_EMAIL_FROM'),
};
