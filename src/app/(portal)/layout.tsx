import type { ReactNode } from 'react';
import ServerShell from '@/components/shell/ServerShell';

export const dynamic = 'force-dynamic';

// Employee / Manager self-service pages inside the one PRET shell.
export default function PortalLayout({ children }: { children: ReactNode }) {
  return <ServerShell>{children}</ServerShell>;
}
