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
        { id: 'leave-apply', label: 'Apply leave', href: '/my/leave/apply' },
        { id: 'leave-applications', label: 'My applications', href: '/my/leave' },
        { id: 'leave-balances', label: 'My balances', href: '/my/leave/balances' },
        { id: 'leave-credits', label: 'Replacement credits', href: '/my/leave/credits' },
        { id: 'leave-calendar', label: 'Leave calendar', href: '/leave/calendar' },
        { id: 'leave-holidays', label: 'Public holidays', href: '/my/holidays' },
      ],
    });
    my.push({
      id: 'my-claims',
      label: 'My Claims',
      icon: 'claims',
      children: [
        { id: 'claims-list', label: 'My claims', href: '/my/claims' },
        { id: 'claims-new', label: 'New claim', href: '/my/claims/new' },
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
        { id: 'profile', label: 'Profile', href: '/my/profile' },
        { id: 'profile-crs', label: 'Change requests', href: '/my/profile/change-requests' },
        { id: 'profile-docs', label: 'Documents', href: '/my/documents' },
        { id: 'profile-data', label: 'Download my data', href: '/my/data-export' },
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
        { id: 'team-members', label: 'Team members', href: '/team' },
        { id: 'team-leave', label: 'Team leave', href: '/team/leave' },
        { id: 'team-balances', label: 'Team balances', href: '/team/balances' },
        { id: 'team-claims', label: 'Team claims', href: '/team/claims' },
        // S-RP-02 team scope (W2-007). Admins reach the same catalogue from Admin ▸ Reports, so the
        // leaf is left out for them (one active nav item per route).
        ...(adm ? [] : [{ id: 'team-reports', label: 'Team reports', href: '/reports' }]),
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
          { id: 'emp-all', label: 'All employees', href: '/employees' },
          { id: 'emp-crs', label: 'Change requests', href: '/employees/change-requests', badge: 'changeRequests' },
          { id: 'emp-bulk', label: 'Bulk update', href: '/employees/bulk-update' },
        ],
      },
      {
        id: 'leave-admin',
        label: 'Leave',
        icon: 'leave',
        children: [
          { id: 'lv-apps', label: 'Applications', href: '/leave/applications' },
          { id: 'lv-balances', label: 'Balances', href: '/leave/balances' },
          { id: 'lv-adjustments', label: 'Adjustments', href: '/leave/adjustments' },
          { id: 'lv-overrides', label: 'Entitlement overrides', href: '/leave/overrides' },
          { id: 'lv-credits', label: 'Replacement credits', href: '/leave/credits' },
          { id: 'lv-calendar', label: 'Calendar', href: '/leave/calendar' },
          { id: 'lv-delegations', label: 'Delegations', href: '/leave/delegations' },
          { id: 'lv-rollover', label: 'Year-end roll-over', href: '/leave/year-end' },
          // IA §3.3 "Setup ▸ Leave types · Entitlement bands · Policy · Approval workflows" (nav is two levels deep).
          { id: 'lv-types', label: 'Setup · Leave types', href: '/leave/setup/types' },
          { id: 'lv-bands', label: 'Setup · Entitlement bands', href: '/leave/setup/bands' },
          { id: 'lv-policy', label: 'Setup · Leave policy', href: '/leave/setup/policy' },
          { id: 'lv-workflows', label: 'Setup · Approval workflows', href: '/leave/setup/workflows' },
        ],
      },
      {
        id: 'claims-admin',
        label: 'Claims',
        icon: 'claims',
        children: [
          { id: 'cl-all', label: 'All claims', href: '/claims' },
          { id: 'cl-batches', label: 'Disbursement batches', href: '/claims/batches' },
          { id: 'cl-late', label: 'Late overrides', href: '/claims/late-overrides' },
          { id: 'cl-bulk', label: 'Bulk entry', href: '/claims/bulk' },
          // IA §3.3 "Setup ▸ Categories & limits (S-CL-05/06/07) · Claims settings (S-CL-08)" (nav is two levels deep).
          { id: 'cl-categories', label: 'Setup · Categories', href: '/claims/setup/categories' },
          { id: 'cl-limits', label: 'Setup · Limits', href: '/claims/setup/limits' },
          { id: 'cl-settings', label: 'Setup · Claims settings', href: '/claims/setup/settings' },
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
          { id: 'org-company', label: 'Company profile', href: '/organisation/company' },
          { id: 'org-departments', label: 'Departments', href: '/organisation/departments' },
          { id: 'org-positions', label: 'Positions', href: '/organisation/positions' },
          { id: 'org-grades', label: 'Grades', href: '/organisation/grades' },
          { id: 'org-locations', label: 'Work locations', href: '/organisation/locations' },
          { id: 'org-patterns', label: 'Working patterns', href: '/organisation/working-patterns' },
          { id: 'org-holidays', label: 'Public holidays', href: '/organisation/holidays' },
          { id: 'org-lines', label: 'Reporting lines', href: '/organisation/reporting-lines' },
          { id: 'org-cost-centres', label: 'Cost centres', href: '/organisation/cost-centres' },
          { id: 'org-groups', label: 'Employee groups', href: '/organisation/groups' },
        ],
      },
      { id: 'reports', label: 'Reports', icon: 'reports', href: '/reports' },
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
        // ADM sees employee users without privileged roles only (BR-ADM-01) and may invite
        // employee users (A6 employee branch, W2-003); SA also invites external administrators.
        children: sa
          ? [
              { id: 'ac-users', label: 'Users', href: '/users' },
              { id: 'ac-invite', label: 'Invite employee user', href: '/users/new?type=employee' },
              { id: 'ac-invite-ext', label: 'Invite external administrator', href: '/users/new?type=external' },
              { id: 'ac-roles', label: 'Role reference', href: '/users/roles' },
            ]
          : [
              { id: 'ac-users', label: 'Users', href: '/users' },
              { id: 'ac-invite', label: 'Invite employee user', href: '/users/new?type=employee' },
              { id: 'ac-roles', label: 'Role reference', href: '/users/roles' },
            ],
      },
      sa
        ? {
            id: 'privacy',
            label: 'Audit & privacy',
            icon: 'privacy',
            children: [
              { id: 'pr-audit', label: 'Audit & access log', href: '/audit' },
              { id: 'pr-review', label: 'Access review', href: '/audit/access-review' },
              { id: 'pr-notice', label: 'Privacy notice', href: '/privacy/notice' },
              { id: 'pr-dsr', label: 'Data-subject requests', href: '/privacy/dsr' },
              { id: 'pr-breach', label: 'Breach & incidents', href: '/privacy/incidents' },
              { id: 'pr-retention', label: 'Retention & anonymisation', href: '/privacy/retention' },
              { id: 'pr-ntf-log', label: 'Notification log', href: '/notifications/log' },
              { id: 'pr-templates', label: 'Notification templates', href: '/notifications/templates' },
            ],
          }
        : {
            id: 'privacy',
            label: 'Privacy & logs',
            icon: 'privacy',
            children: [
              { id: 'pr-notice', label: 'Privacy notice', href: '/privacy/notice' },
              { id: 'pr-dsr', label: 'Data-subject requests', href: '/privacy/dsr' },
              { id: 'pr-ntf-log', label: 'Notification log', href: '/notifications/log' },
            ],
          },
      { id: 'settings', label: 'Settings', icon: 'settings', href: '/settings' },
    ];
    sections.push({ id: 'system', heading: 'System', items: system });
  }

  return sections;
}

/** Longest-prefix match so "/my/claims/new" activates "New claim", not "My claims". */
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

/** Global screens reached from the top bar / user menu, not the left nav (G5, G6, G7). */
const GLOBAL_TITLES: Record<string, string> = {
  '/notifications': 'Notifications',
  '/account': 'Account settings',
  '/privacy-notice': 'Privacy notice',
};

/** Default page title from the nav (pages may override via <PageTitle>). */
export function resolveTitle(sections: NavSection[], pathname: string): { title: string; parent?: string } {
  const { item, leaf } = findActive(sections, pathname);
  if (leaf && item) return { title: leaf.label, parent: item.label };
  if (item) return { title: item.label };
  if (GLOBAL_TITLES[pathname]) return { title: GLOBAL_TITLES[pathname] };
  return { title: 'PRET' };
}
