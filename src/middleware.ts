// Session refresh on every request except static assets (system-design §2). Server
// Components cannot write cookies, so without this a rotated Supabase refresh token
// would be lost. Authorisation and the idle timeout are enforced by requireUser.
import type { NextRequest } from 'next/server';
import { updateSession } from '@/server/auth/middleware-session';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|txt)$).*)'],
};
