// Session refresh for Next.js middleware (system-design §2). Edge-safe: no pg, no node:*.
// Usage in src/middleware.ts:
//
//   import type { NextRequest } from 'next/server';
//   import { updateSession } from '@/server/auth/middleware-session';
//   export async function middleware(request: NextRequest) { return updateSession(request); }
//   export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'] };
//
// It refreshes an expiring access token with the refresh token and writes the rotated
// cookies to BOTH the request (for this render) and the response — Server Components cannot
// write cookies, so without this a rotated refresh token would be lost.
import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(list: CookieToSet[]) {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  // Refreshes the session when needed (no business data is read here; authorisation and
  // the idle timeout are enforced by getCurrentUser/requireUser against the database).
  await supabase.auth.getSession();

  response.headers.set('Cache-Control', 'no-store');
  return response;
}
