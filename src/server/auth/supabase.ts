import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env';

type CookieToSet = { name: string; value: string; options: CookieOptions };

/**
 * Supabase client bound to the request's auth cookies (sign-in, MFA, sign-out, Storage
 * signed URLs as the user). Never used for business data — that goes through withUserTx.
 * In Server Components cookie writes are not allowed; the middleware refreshes sessions.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const store = await cookies();
  return createServerClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(list: CookieToSet[]) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component — ignored; middleware persists refreshed cookies.
        }
      },
    },
  });
}

/** Stateless client that acts with one user's access token (Storage calls "as the user"). */
export function createSupabaseUserClient(accessToken: string): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * Auth admin client (secret key) — only for: creating the Auth user when an invitation is
 * accepted, and global sign-out on disable/role change. Returns null when the key is absent.
 */
export function createSupabaseAdminClient(): SupabaseClient | null {
  const key = env.supabaseSecretKey();
  if (!key) return null;
  return createClient(env.supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/**
 * W2-006 G6 change password: a throw-away client with no cookie storage, used ONLY to re-authenticate the signed-in user
 * with their current password (the request's own session cookies are never replaced). Its session is revoked afterwards.
 */
export function createSupabaseStatelessClient(): SupabaseClient {
  return createClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
