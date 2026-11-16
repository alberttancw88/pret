import type { ReactNode } from 'react';
import ServerShell from '@/components/shell/ServerShell';

export const dynamic = 'force-dynamic';

// Admin workspace pages inside the same shell. Each page enforces its own roles.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <ServerShell>{children}</ServerShell>;
}
