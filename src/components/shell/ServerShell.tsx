// Server wrapper for authenticated route groups: resolves the user, filters the nav by
// role on the server, and renders the client AppShell. Pages must STILL call requireUser
// (with their own roles) — layouts don't re-run on every client navigation and hidden
// nav items are not access control (FR-G-02).
import 'server-only';
import * as React from 'react';
import { requireUser } from '@/server/auth/current-user';
import { getInboxCounts } from '@/server/queries/approvals';
import { getShellStatus } from '@/server/queries/portal';
import type { ShellStatus } from '@/server/contracts/portal';
import pkg from '../../../package.json';
import AppShell from './AppShell';
import { buildNav, canApprove, isEmployeeUser, roleChipLabel } from './nav';

export default async function ServerShell({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const sections = buildNav(user);
  // Approvals badge = actionable items (W2-004: leave, cancellations, credits; claims join in W2-005).
  let approvals = 0;
  if (canApprove(user)) {
    try {
      const c = await getInboxCounts();
      approvals = c.leave + c.cancellations + c.credits + c.claims + c.batches;
    } catch {
      approvals = 0;
    }
  }

  // G5 bell + G7 privacy link (W2-006). A failure never blocks the page: the bell starts
  // empty and refreshes itself on the next navigation.
  let status: ShellStatus = { notifications: { items: [], unreadCount: 0 }, privacyNoticePublished: false, hasEmployeeRecord: false };
  try {
    status = await getShellStatus();
  } catch {
    /* keep defaults */
  }

  return (
    <AppShell
      sections={sections}
      user={{ id: user.id, displayName: user.displayName, roleLabel: roleChipLabel(user), isExternal: user.isExternal }}
      version={pkg.version}
      showBottomBar={isEmployeeUser(user)}
      canApprove={canApprove(user)}
      badges={{ approvals, changeRequests: 0 }}
      notifications={status.notifications.items}
      unreadCount={status.notifications.unreadCount}
      privacyNoticePublished={status.privacyNoticePublished}
      idleTimeoutMin={user.idleTimeoutMin}
    >
      {children}
    </AppShell>
  );
}
