// Server wrapper for authenticated route groups: resolves the user, filters the nav by
// role on the server, and renders the client AppShell. Pages must STILL call requireUser
// (with their own roles) — layouts don't re-run on every client navigation and hidden
// nav items are not access control (FR-G-02).
import 'server-only';
import * as React from 'react';
import { requireUser } from '@/server/auth/current-user';
import pkg from '../../../package.json';
import AppShell from './AppShell';
import { buildNav, canApprove, isEmployeeUser, roleChipLabel } from './nav';

export default async function ServerShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections = buildNav(user);

  return (
    <AppShell
      sections={sections}
      user={{ displayName: user.displayName, roleLabel: roleChipLabel(user), isExternal: user.isExternal }}
      version={pkg.version}
      showBottomBar={isEmployeeUser(user)}
      canApprove={canApprove(user)}
      // Counts and notifications are wired by W2-006/W2-007; 0 hides the badges.
      badges={{ approvals: 0, changeRequests: 0 }}
      notifications={[]}
      unreadCount={0}
      privacyNoticePublished={false}
      idleTimeoutMin={user.idleTimeoutMin}
    >
      {children}
    </AppShell>
  );
}
