// Navigation config — information-architecture.md §3 and components.md §9.1.
// Server-safe (no React): the (portal)/(admin) layouts call `buildNav(user)` on the
// server so items a user may not see are ABSENT from the DOM. Hiding is convenience only:
// every route, Server Action and RLS policy enforces access separately (FR-G-02).

/** Mirrors `Role` in `@/server/auth/current-user` (Backend lane). */
export type ShellRole = 'SA' | 'ADM' | 'MGR' | 'EMP';

/** The subset of `CurrentUser` the shell needs (structurally compatible). */
export type ShellUser = {
  displayName: string;
  roles: ShellRole[];
  isExternal: boolean;
  employeeNo: string | null;
};

export type NavIconKey =
  | 'home'
  | 'dashboard'
  | 'leave'
  | 'claims'
  | 'pay'
  | 'profile'
  | 'directory'
  | 'approvals'
  | 'team'
  | 'employees'
  | 'payroll'
  | 'organisation'
  | 'reports'
  | 'imports'
  | 'users'
  | 'privacy'
  | 'settings';

export type NavBadgeKey = 'approvals' | 'changeRequests';

export type NavLeaf = { id: string; label: string; href: string; badge?: NavBadgeKey };
export type NavItem = {
  id: string;
  label: string;
  icon: NavIconKey;
  href?: string;
  badge?: NavBadgeKey;
  children?: NavLeaf[];
};
export type NavSection = { id: string; heading?: string; items: NavItem[] };

/** R1.1 (payroll) screens stay out of the nav until Release 1.1 ships. */
export const RELEASE_R11 = false;

/** Highest role wins: Super Admin > Admin > Manager > Employee (IA §1.3). */
export function roleChipLabel(user: ShellUser): string {
  if (user.isExternal) return 'Admin · External';
  if (user.roles.includes('SA')) return 'Super Admin';
  if (user.roles.includes('ADM')) return 'Admin';
  if (user.roles.includes('MGR')) return 'Manager';
  return 'Employee';
}

/** An employee user (has an employee record, never External) sees the "My …" items. */
export function isEmployeeUser(user: ShellUser): boolean {
  return !user.isExternal && user.employeeNo !== null;
}

export function isAdmin(user: ShellUser): boolean {
  return user.roles.includes('ADM') || user.roles.includes('SA');
}

export function canApprove(user: ShellUser): boolean {
  return user.roles.includes('MGR') || isAdmin(user);
}

/** Landing page after sign-in (IA §4). */
export function landingPath(user: ShellUser): string {
  return isAdmin(user) ? '/dashboard' : '/home';
}

export function buildNav(user: ShellUser): NavSection[] {
  const sa = user.roles.includes('SA');
  const adm = isAdmin(user);
  const mgr = user.roles.includes('MGR') && !user.isExternal;
  const emp = isEmployeeUser(user);
  const sections: NavSection[] = [];

  if (adm) sections.push({ id: 'top', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'dashboard', href: '/dashboard' }] });

  // MY SPACE — self-service (never for External users, EC-PRT-02)
  const my: NavItem[] = [];
  if (emp) {
    my.push({ id: 'home', label: 'Home', icon: 'home', href: '/home' });
    my.push({
      id: 'my-leave',
      label: 'My Leave',
      icon: 'leave',
      children: [
        { id: 'leave-apply', label: 'Apply leave', href: '/leave/apply' },
        { id: 'leave-applications', label: 'My applications', href: '/leave/applications' },
        { id: 'leave-balances', label: 'My balances', href: '/leave/balances' },
        { id: 'leave-credits', label: 'Replacement credits', href: '/leave/credits' },
        { id: 'leave-calendar', label: 'Leave calendar', href: '/leave/calendar' },
        { id: 'leave-holidays', label: 'Public holidays', href: '/leave/holidays' },
      ],
    });
    my.push({
      id: 'my-claims',
      label: 'My Claims',
      icon: 'claims',
      children: [
        { id: 'claims-list', label: 'My claims', href: '/claims' },
        { id: 'claims-new', label: 'New claim', href: '/claims/new' },
      ],
    });
    if (RELEASE_R11) {
      my.push({
        id: 'my-pay',
        label: 'My Pay',
        icon: 'pay',
        children: [
          { id: 'pay-payslips', label: 'Payslips', href: '/pay/payslips' },
          { id: 'pay-ea', label: 'EA forms', href: '/pay/ea-forms' },
          { id: 'pay-ytd', label: 'YTD statement', href: '/pay/ytd' },
          { id: 'pay-tp1', label: 'TP1 declarations', href: '/pay/tp1' },
        ],
      });
    }
    my.push({
      id: 'my-profile',
      label: 'My Profile',
      icon: 'profile',
      children: [
        { id: 'profile', label: 'Profile', href: '/profile' },
        { id: 'profile-crs', label: 'Change requests', href: '/profile/change-requests' },
        { id: 'profile-docs', label: 'Documents', href: '/profile/documents' },
        { id: 'profile-data', label: 'Download my data', href: '/profile/my-data' },
      ],
    });
  }
  my.push({
    id: 'directory',
    label: 'Directory',
    icon: 'directory',
    children: [
      { id: 'directory-staff', label: 'Staff directory', href: '/directory' },
      { id: 'directory-org', label: 'Org chart', href: '/org-chart' },
    ],
  });
  sections.push({ id: 'my', heading: 'My space', items: my });

  // WORK — approvals and team
  const work: NavItem[] = [];
  if (canApprove(user)) work.push({ id: 'approvals', label: 'Approvals', icon: 'approvals', href: '/approvals', badge: 'approvals' });
  if (mgr) {
    work.push({
      id: 'my-team',
      label: 'My Team',
      icon: 'team',
      children: [
        { id: 'team-members', label: 'Team members', href: '/team/members' },
        { id: 'team-leave', label: 'Team leave', href: '/team/leave' },
        { id: 'team-balances', label: 'Team balances', href: '/team/balances' },
        { id: 'team-claims', label: 'Team claims', href: '/team/claims' },
        { id: 'team-reports', label: 'Team reports', href: '/team/reports' },
      ],
    });
  }
  if (work.length) sections.push({ id: 'work', heading: 'Work', items: work });

  // ADMIN workspace (ADM, SA)
  if (adm) {
    const admin: NavItem[] = [
      {
        id: 'employees',
        label: 'Employees',
        icon: 'employees',
        children: [
          { id: 'emp-all', label: 'All employees', href: '/admin/employees' },
          { id: 'emp-crs', label: 'Change requests', href: '/admin/employees/change-requests', badge: 'changeRequests' },
          { id: 'emp-bulk', label: 'Bulk update', href: '/admin/employees/bulk-update' },
        ],
      },
      {
        id: 'leave-admin',
        label: 'Leave',
        icon: 'leave',
        children: [
          { id: 'lv-apps', label: 'Applications', href: '/admin/leave/applications' },
          { id: 'lv-balances', label: 'Balances', href: '/admin/leave/balances' },
          { id: 'lv-adjustments', label: 'Adjustments', href: '/admin/leave/adjustments' },
          { id: 'lv-overrides', label: 'Entitlement overrides', href: '/admin/leave/overrides' },
          { id: 'lv-credits', label: 'Replacement credits', href: '/admin/leave/credits' },
          { id: 'lv-calendar', label: 'Calendar', href: '/admin/leave/calendar' },
          { id: 'lv-delegations', label: 'Delegations', href: '/admin/leave/delegations' },
          { id: 'lv-rollover', label: 'Year-end roll-over', href: '/admin/leave/roll-over' },
          { id: 'lv-setup', label: 'Setup', href: '/admin/leave/setup' },
        ],
      },
      {
        id: 'claims-admin',
        label: 'Claims',
        icon: 'claims',
        children: [
          { id: 'cl-all', label: 'All claims', href: '/admin/claims' },
          { id: 'cl-batches', label: 'Disbursement batches', href: '/admin/claims/batches' },
          { id: 'cl-late', label: 'Late overrides', href: '/admin/claims/late-overrides' },
          { id: 'cl-bulk', label: 'Bulk entry', href: '/admin/claims/bulk-entry' },
          { id: 'cl-setup', label: 'Setup', href: '/admin/claims/setup' },
        ],
      },
    ];
    if (RELEASE_R11) {
      admin.push({
        id: 'payroll',
        label: 'Payroll',
        icon: 'payroll',
        children: [
          { id: 'py-runs', label: 'Payroll runs', href: '/admin/payroll/runs' },
          { id: 'py-payslips', label: 'Payslips', href: '/admin/payroll/payslips' },
          { id: 'py-statutory', label: 'Statutory outputs', href: '/admin/payroll/statutory' },
          { id: 'py-annual', label: 'Annual returns (EA / Form E)', href: '/admin/payroll/annual' },
          { id: 'py-tp', label: 'TP1 / TP3 / CP38', href: '/admin/payroll/tp' },
          { id: 'py-parallel', label: 'Parallel run', href: '/admin/payroll/parallel' },
          { id: 'py-reports', label: 'Payroll reports', href: '/admin/payroll/reports' },
          { id: 'py-setup', label: 'Setup', href: '/admin/payroll/setup' },
        ],
      });
    }
    admin.push(
      {
        id: 'organisation',
        label: 'Organisation',
        icon: 'organisation',
        children: [
          { id: 'org-company', label: 'Company profile', href: '/admin/organisation/company' },
          { id: 'org-departments', label: 'Departments', href: '/admin/organisation/departments' },
          { id: 'org-positions', label: 'Positions', href: '/admin/organisation/positions' },
          { id: 'org-grades', label: 'Grades', href: '/admin/organisation/grades' },
          { id: 'org-locations', label: 'Work locations', href: '/admin/organisation/locations' },
          { id: 'org-patterns', label: 'Working patterns', href: '/admin/organisation/working-patterns' },
          { id: 'org-holidays', label: 'Public holidays', href: '/admin/organisation/public-holidays' },
          { id: 'org-lines', label: 'Reporting lines', href: '/admin/organisation/reporting-lines' },
        ],
      },
      { id: 'reports', label: 'Reports', icon: 'reports', href: '/admin/reports' },
      {
        id: 'imports',
        label: 'Imports',
        icon: 'imports',
        children: [
          { id: 'im-import', label: 'Import data', href: '/admin/imports' },
          { id: 'im-recon', label: 'Migration reconciliation', href: '/admin/imports/reconciliation' },
        ],
      },
    );
    sections.push({ id: 'admin', heading: 'Admin', items: admin });

    // SYSTEM
    const system: NavItem[] = [
      {
        id: 'users',
        label: 'Users & access',
        icon: 'users',
        children: sa
          ? [
              { id: 'ac-users', label: 'Users', href: '/admin/access/users' },
              { id: 'ac-invite-ext', label: 'Invite external administrator', href: '/admin/access/users/invite-external' },
              { id: 'ac-roles', label: 'Role reference', href: '/admin/access/roles' },
            ]
          : [
              { id: 'ac-users', label: 'Users', href: '/admin/access/users' },
              { id: 'ac-roles', label: 'Role reference', href: '/admin/access/roles' },
            ],
      },
      sa
        ? {
            id: 'privacy',
            label: 'Audit & privacy',
            icon: 'privacy',
            children: [
              { id: 'pr-audit', label: 'Audit & access log', href: '/admin/privacy/audit' },
              { id: 'pr-review', label: 'Access review', href: '/admin/privacy/access-review' },
              { id: 'pr-notice', label: 'Privacy notice', href: '/admin/privacy/notice' },
              { id: 'pr-dsr', label: 'Data-subject requests', href: '/admin/privacy/dsr' },
              { id: 'pr-breach', label: 'Breach & incidents', href: '/admin/privacy/breaches' },
              { id: 'pr-retention', label: 'Retention & anonymisation', href: '/admin/privacy/retention' },
              { id: 'pr-ntf-log', label: 'Notification log', href: '/admin/privacy/notification-log' },
              { id: 'pr-templates', label: 'Notification templates', href: '/admin/privacy/notification-templates' },
            ],
          }
        : {
            id: 'privacy',
            label: 'Privacy & logs',
            icon: 'privacy',
            children: [
              { id: 'pr-notice', label: 'Privacy notice', href: '/admin/privacy/notice' },
              { id: 'pr-dsr', label: 'Data-subject requests', href: '/admin/privacy/dsr' },
              { id: 'pr-ntf-log', label: 'Notification log', href: '/admin/privacy/notification-log' },
            ],
          },
      { id: 'settings', label: 'Settings', icon: 'settings', href: '/admin/settings' },
    ];
    sections.push({ id: 'system', heading: 'System', items: system });
  }

  return sections;
}

/** Longest-prefix match so "/claims/new" activates "New claim", not "My claims". */
export function findActive(sections: NavSection[], pathname: string): { item?: NavItem; leaf?: NavLeaf } {
  let best: { item?: NavItem; leaf?: NavLeaf; len: number } = { len: -1 };
  const matches = (href: string) => pathname === href || pathname.startsWith(href + '/');
  for (const section of sections) {
    for (const item of section.items) {
      if (item.href && matches(item.href) && item.href.length > best.len) best = { item, len: item.href.length };
      for (const leaf of item.children ?? []) {
        if (matches(leaf.href) && leaf.href.length > best.len) best = { item, leaf, len: leaf.href.length };
      }
    }
  }
  return { item: best.item, leaf: best.leaf };
}

/** Default page title from the nav (pages may override via <PageTitle>). */
export function resolveTitle(sections: NavSection[], pathname: string): { title: string; parent?: string } {
  const { item, leaf } = findActive(sections, pathname);
  if (leaf && item) return { title: leaf.label, parent: item.label };
  if (item) return { title: item.label };
  return { title: 'PRET' };
}
