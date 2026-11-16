import 'server-only';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import { env } from '../env';
import { brandVerified, type JwtClaims, type VerifiedClaims } from './claims';
import { createSupabaseServerClient } from './supabase';

// JWKS verification of Supabase access tokens (system-design §2: "getClaims via JWKS").
// Asymmetric keys (ES256/RS256) are verified locally against the project's JWKS; a legacy
// HS256 token cannot be verified with a public key set, so it is checked with the Auth
// server (auth.getUser) instead. The result is the only source of VerifiedClaims.

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  jwks ??= createRemoteJWKSet(new URL(`${env.supabaseUrl()}/auth/v1/.well-known/jwks.json`), {
    cacheMaxAge: 10 * 60 * 1000,
  });
  return jwks;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asClaims(p: JWTPayload): JwtClaims | null {
  if (typeof p.sub !== 'string' || !UUID_RE.test(p.sub)) return null;
  if (p.role !== 'authenticated') return null;
  return p as unknown as JwtClaims;
}

export async function verifyAccessToken(token: string): Promise<VerifiedClaims | null> {
  if (!token) return null;
  try {
    const header = decodeProtectedHeader(token);
    if (typeof header.alg === 'string' && header.alg.startsWith('HS')) {
      const supabase = await createSupabaseServerClient();
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) return null;
      const claims = asClaims(decodeJwt(token));
      if (!claims || claims.sub !== data.user.id) return null;
      if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) return null;
      return brandVerified(claims);
    }
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `${env.supabaseUrl()}/auth/v1`,
      audience: 'authenticated',
    });
    const claims = asClaims(payload);
    return claims ? brandVerified(claims) : null;
  } catch {
    return null;
  }
}

export interface VerifiedSession {
  claims: VerifiedClaims;
  accessToken: string;
}

/** Reads the session from the auth cookies and verifies its access token. */
export async function getVerifiedSession(): Promise<VerifiedSession | null> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const claims = await verifyAccessToken(token);
  return claims ? { claims, accessToken: token } : null;
}
