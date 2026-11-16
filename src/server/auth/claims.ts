// Claims of a Supabase access token. `VerifiedClaims` is branded: only
// src/server/auth/jwt.ts (JWKS / Auth-server verification) can produce one, so withUserTx
// can never be handed client-supplied claims (ADR-0002 consequence).

declare const verifiedBrand: unique symbol;

export interface JwtClaims {
  sub: string;
  role: string;
  aal?: 'aal1' | 'aal2' | string;
  session_id?: string;
  email?: string;
  exp?: number;
  iat?: number;
  iss?: string;
  aud?: string | string[];
  amr?: unknown;
  [key: string]: unknown;
}

export type VerifiedClaims = JwtClaims & { readonly [verifiedBrand]: true };

/** Only for use by the verifier module. */
export function brandVerified(claims: JwtClaims): VerifiedClaims {
  return claims as VerifiedClaims;
}
