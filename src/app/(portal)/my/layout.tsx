import type { ReactNode } from 'react';
import { denyAccess, requireUser } from '@/server/auth/current-user';

export const dynamic = 'force-dynamic';

// "My …" pages (FR-PRT-12, EC-PRT-02): external administrators have no employee record and
// never see "My" items — a direct URL renders G8 "Not found or no access", and the attempt is
// written to the access log (US-ADMIN-020/021). Each page still runs its own requireUser([...])
// and the queries return only the caller's own rows (RLS).
export default async function MyLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  if (user.isExternal) await denyAccess('/my', 'Denied: external administrator');
  return <>{children}</>;
}
