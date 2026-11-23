'use client';

// PRET app shell — components.md §9, wireframes.md §0.1, IA §2; Sunrise shell theme-tokens.md §8.
// AppBar (top, canvas until scrolled) + Drawer (left: permanent ≥ 1024 px, collapsible to an
// 80 px rail; temporary below 1024 px; pastel icon tiles) + main + floating BottomNavigation
// (phone < 600 px, employee users).
// `sections` arrive already filtered by role on the server (buildNav), so unauthorised
// items are absent from the DOM. That is NOT access control — every page calls requireUser.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import AppBar from '@mui/material/AppBar';
import Avatar from '@mui/material/Avatar';
import Badge from '@mui/material/Badge';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import MenuIcon from '@mui/icons-material/Menu';
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft';
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';
import LockIcon from '@mui/icons-material/Lock';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import SpaceDashboardOutlinedIcon from '@mui/icons-material/SpaceDashboardOutlined';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import AssessmentOutlinedIcon from '@mui/icons-material/AssessmentOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import PolicyOutlinedIcon from '@mui/icons-material/PolicyOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import ContactsOutlinedIcon from '@mui/icons-material/ContactsOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';

import { signOut } from '@/server/actions/auth';
import type { TileName } from '@/theme/augment';
import { tileFor } from '@/theme/palette';
import StatusChip, { isStatusValue } from '../StatusChip';
import { findActive, resolveTitle, type NavBadgeKey, type NavIconKey, type NavItem, type NavSection } from './nav';
import { PageTitleProvider, usePageTitleOverride } from './PageTitle';
import NotificationPanel, { type ShellNotification } from './NotificationPanel';
import type { NotificationRow } from '@/server/contracts/portal';
import { fetchNotificationPanel, markAllNotificationsRead, openNotification } from '@/server/actions/portal';
import { relativeTime } from '../portal/common';
import IdleTimeout from './IdleTimeout';
import UnsavedWorkRestorer from './UnsavedWorkRestorer';

const ICONS: Record<NavIconKey, React.ElementType> = {
  home: HomeOutlinedIcon,
  dashboard: SpaceDashboardOutlinedIcon,
  leave: EventAvailableOutlinedIcon,
  claims: ReceiptLongOutlinedIcon,
  pay: RequestQuoteOutlinedIcon,
  profile: PersonOutlineIcon,
  directory: ContactsOutlinedIcon,
  approvals: TaskAltOutlinedIcon,
  team: GroupsOutlinedIcon,
  employees: PeopleOutlineIcon,
  payroll: PaymentsOutlinedIcon,
  organisation: AccountTreeOutlinedIcon,
  reports: AssessmentOutlinedIcon,
  imports: UploadFileOutlinedIcon,
  users: ManageAccountsOutlinedIcon,
  privacy: PolicyOutlinedIcon,
  settings: SettingsOutlinedIcon,
};

/** Fixed tile hue per nav item — five hues only (theme-tokens.md §8.1, calm rule 4). */
const NAV_TILE: Record<NavIconKey, TileName> = {
  home: 'lavender',
  dashboard: 'lavender',
  approvals: 'lavender',
  employees: 'lavender',
  reports: 'lavender',
  leave: 'mint',
  users: 'mint',
  claims: 'peach',
  settings: 'peach',
  payroll: 'sky',
  pay: 'sky',
  directory: 'sky',
  organisation: 'rose',
  team: 'rose',
  privacy: 'rose',
  imports: 'rose',
  profile: 'rose',
};

const COLLAPSE_KEY = 'pret.nav.collapsed';

/** 32 × 32 pastel icon tile (§8.1). On the active (violet) item it turns translucent white. */
function NavIconTile({ icon: Icon, hue, active }: { icon: React.ElementType; hue: TileName; active?: boolean }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={(t) => ({
        width: 32,
        height: 32,
        borderRadius: '11px',
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: active ? 'rgba(255,255,255,0.20)' : t.palette.tile[hue].bg,
        color: active ? '#FFFFFF' : t.palette.tile[hue].ink,
      })}
    >
      <Icon sx={{ fontSize: 20 }} />
    </Box>
  );
}

/** Rounded-square initials avatar; hue fixed per person (§0 rule 10). */
function UserAvatar({ name, seed, size = 32 }: { name: string; seed: string; size?: number }) {
  const hue = tileFor(seed);
  return (
    <Avatar
      variant="rounded"
      sx={(t) => ({ width: size, height: size, bgcolor: t.palette.tile[hue].bg, color: t.palette.tile[hue].ink, fontSize: '0.75rem', fontWeight: 800 })}
    >
      <span aria-hidden>{initials(name)}</span>
    </Avatar>
  );
}

function RoleChip({ label }: { label: string }) {
  return isStatusValue('role', label) ? (
    <StatusChip set="role" value={label} />
  ) : (
    <Chip label={label} size="small" sx={{ height: 20, fontSize: '0.6875rem', fontWeight: 700 }} />
  );
}

function CountBadge({ count, label, onDark }: { count: number; label: string; onDark?: boolean }) {
  return (
    <Box
      component="span"
      aria-label={label}
      sx={{
        ml: 1,
        minWidth: 20,
        height: 20,
        px: 0.75,
        borderRadius: '999px',
        bgcolor: 'error.main',
        color: '#FFFFFF',
        fontSize: '0.75rem',
        fontWeight: 700,
        lineHeight: '20px',
        textAlign: 'center',
        flexShrink: 0,
        ...(onDark && { boxShadow: '0 0 0 2px #FFFFFF' }),
      }}
    >
      {countLabel(count)}
    </Box>
  );
}

/** True while the phone's on-screen keyboard is open (the bottom bar hides, §8.3). */
function useKeyboardOpen(enabled: boolean) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const check = () => setOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener('resize', check);
    return () => vv.removeEventListener('resize', check);
  }, [enabled]);
  return open;
}

/** The top bar turns white with a hairline once the page scrolls (§8.2). */
function useScrolled() {
  const [scrolled, setScrolled] = React.useState(false);
  React.useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return scrolled;
}

export type AppShellProps = {
  sections: NavSection[];
  user: { id?: string; displayName: string; roleLabel: string; isExternal: boolean };
  version: string;
  /** Show the phone bottom bar (employee users only, IA §2). */
  showBottomBar: boolean;
  /** Approvals slot in the bottom bar (MGR/ADM/SA); otherwise Profile. */
  canApprove: boolean;
  badges?: Partial<Record<NavBadgeKey, number>>;
  /** Bell panel (G5): latest notifications from getShellStatus(). */
  notifications?: NotificationRow[];
  unreadCount?: number;
  privacyNoticePublished?: boolean;
  helpHref?: string;
  /** Per-user idle timeout in minutes (F-ADM-14); omit to disable the warning. */
  idleTimeoutMin?: number;
  children: React.ReactNode;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

function countLabel(n: number) {
  return n > 99 ? '99+' : String(n);
}

/** Pages that change read state (e.g. /notifications) tell the bell the new unread count. */
export const NOTIFICATIONS_CHANGED_EVENT = 'pret:notifications-changed';
export function announceUnreadCount(unreadCount: number) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(NOTIFICATIONS_CHANGED_EVENT, { detail: { unreadCount } }));
}

/**
 * G5 bell state: starts from the server render, refreshes on navigation (the layout does not
 * re-render on client navigation), on window focus and when the bell opens.
 */
function useBell(initialItems: NotificationRow[], initialUnread: number) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [items, setItems] = React.useState(initialItems);
  const [unread, setUnread] = React.useState(initialUnread);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const last = React.useRef(0);

  const refresh = React.useCallback(async (show = false) => {
    last.current = Date.now();
    if (show) setLoading(true);
    try {
      const res = await fetchNotificationPanel();
      if (res.ok) {
        setItems(res.panel.items);
        setUnread(res.panel.unreadCount);
        setError(null);
      } else if (show) setError("Couldn't load notifications.");
    } catch {
      if (show) setError("Couldn't load notifications.");
    } finally {
      if (show) setLoading(false);
    }
  }, []);

  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      last.current = Date.now();
      return;
    }
    if (Date.now() - last.current > 5000) void refresh();
  }, [pathname, refresh]);

  React.useEffect(() => {
    const onFocus = () => Date.now() - last.current > 30000 && void refresh();
    const onChanged = (e: Event) => {
      const n = (e as CustomEvent<{ unreadCount?: number }>).detail?.unreadCount;
      if (typeof n === 'number') setUnread(n);
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChanged);
    };
  }, [refresh]);

  const panelItems: ShellNotification[] = items.map((n) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    href: n.href,
    when: relativeTime(n.createdAt),
    unread: n.unread,
  }));

  const open = async (n: ShellNotification, close: () => void) => {
    close();
    setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, unread: false } : x)));
    let href = n.href;
    try {
      const res = await openNotification({ id: n.id });
      if (res.ok) {
        setUnread(res.unreadCount);
        href = res.href ?? href;
      }
    } catch {
      /* still follow the link */
    }
    if (href && href.startsWith('/') && !href.startsWith('//')) router.push(href);
    else router.push('/notifications');
  };

  const markAll = async () => {
    setItems((xs) => xs.map((x) => ({ ...x, unread: false })));
    setUnread(0);
    try {
      const res = await markAllNotificationsRead();
      if (!res.ok) void refresh();
    } catch {
      void refresh();
    }
  };

  return { panelItems, unread, loading, error, refresh, open, markAll };
}

export default function AppShell(props: AppShellProps) {
  return (
    <PageTitleProvider>
      <ShellFrame {...props} />
    </PageTitleProvider>
  );
}

function ShellFrame({
  sections,
  user,
  version,
  showBottomBar,
  canApprove,
  badges = {},
  notifications = [],
  unreadCount = 0,
  privacyNoticePublished = false,
  helpHref,
  idleTimeoutMin,
  children,
}: AppShellProps) {
  const theme = useTheme();
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: false });
  const isPhone = useMediaQuery(theme.breakpoints.down('sm'));
  const pathname = usePathname() ?? '';
  const override = usePageTitleOverride();

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [userMenu, setUserMenu] = React.useState<HTMLElement | null>(null);
  const [bellAnchor, setBellAnchor] = React.useState<HTMLElement | null>(null);
  const bell = useBell(notifications, unreadCount);

  // Remember the rail state per browser (best-effort; storage may be unavailable).
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* ignore */
    }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !c;
    });
  };

  React.useEffect(() => setMobileOpen(false), [pathname]);

  const rail = isDesktop && collapsed;
  const drawerWidth = rail ? theme.pret.drawerCollapsed : theme.pret.drawerWidth;
  const navTitle = resolveTitle(sections, pathname);
  const title = override?.title ?? navTitle.title;
  const crumbs = override ? override.breadcrumbs : navTitle.parent ? [{ label: navTitle.parent }] : undefined;
  const { item: activeItem, leaf: activeLeaf } = findActive(sections, pathname);

  const drawer = (
    <DrawerContent
      sections={sections}
      rail={rail}
      user={user}
      version={version}
      badges={badges}
      activeItemId={activeItem?.id}
      activeLeafId={activeLeaf?.id}
      onToggleRail={isDesktop ? toggleCollapsed : undefined}
      privacyNoticePublished={privacyNoticePublished}
      helpHref={helpHref}
    />
  );

  // Bottom bar (UXQ-07): Home · Leave · Claims · Approvals|Profile · More
  const bottomItems = [
    { value: 'home', label: 'Home', href: '/home', icon: HomeOutlinedIcon, match: ['/home'] },
    { value: 'leave', label: 'Leave', href: '/my/leave', icon: EventAvailableOutlinedIcon, match: ['/my/leave', '/leave'] },
    { value: 'claims', label: 'Claims', href: '/my/claims', icon: ReceiptLongOutlinedIcon, match: ['/my/claims', '/claims', '/team/claims'] },
    canApprove
      ? { value: 'approvals', label: 'Approvals', href: '/approvals', icon: TaskAltOutlinedIcon, match: ['/approvals'], badge: badges.approvals ?? 0 }
      : { value: 'profile', label: 'Profile', href: '/my/profile', icon: PersonOutlineIcon, match: ['/my'] },
  ];
  const bottomValue =
    bottomItems.find((b) => b.match.some((m) => pathname === m || pathname.startsWith(m + '/')))?.value ?? (mobileOpen ? 'more' : false);
  const keyboardOpen = useKeyboardOpen(showBottomBar && isPhone);
  const bottomBar = showBottomBar && isPhone;
  const scrolled = useScrolled();
  const userSeed = user.id ?? user.displayName;

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100dvh',
        bgcolor: 'background.default',
        // Phone pass (W2-006): sticky page actions sit ABOVE the floating bottom bar, not under it.
        // The variable is the distance from the screen bottom to the bar's top edge (§8.3).
        '--pret-bottom-bar': bottomBar ? 'calc(64px + 12px + env(safe-area-inset-bottom))' : 'env(safe-area-inset-bottom)',
      }}
    >
      <AppBar
        position="fixed"
        className={scrolled ? 'pret-scrolled' : undefined}
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          transition: theme.transitions.create(['width', 'margin'], { duration: theme.transitions.duration.standard }),
        }}
      >
        <Toolbar sx={{ gap: 1, minHeight: { xs: 56, md: 64 }, px: { xs: 1, sm: 2, md: 4 } }}>
          <IconButton
            edge="start"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: 'none' } }}
            aria-label="Open menu"
            aria-controls="pret-nav-drawer"
            aria-expanded={mobileOpen}
          >
            <MenuIcon />
          </IconButton>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            {crumbs && crumbs.length > 0 && (
              <Typography
                variant="caption"
                component="nav"
                aria-label="Breadcrumb"
                color="text.secondary"
                noWrap
                sx={{ display: { xs: 'none', sm: 'block' } }}
              >
                {crumbs.map((c, i) => (
                  <React.Fragment key={`${c.label}-${i}`}>
                    {c.href ? (
                      <Link component={NextLink} href={c.href} sx={{ fontWeight: 600 }}>
                        {c.label}
                      </Link>
                    ) : (
                      c.label
                    )}
                    <Box component="span" aria-hidden sx={{ mx: 0.75 }}>
                      ›
                    </Box>
                  </React.Fragment>
                ))}
              </Typography>
            )}
            <Typography variant="h3" component="h1" noWrap>
              {title}
            </Typography>
          </Box>

          {user.isExternal && (
            <Tooltip title="Every record you open is logged">
              <Chip
                icon={<LockIcon aria-hidden />}
                label="Access is logged"
                size="small"
                variant="outlined"
                sx={{
                  display: { xs: 'none', sm: 'inline-flex' },
                  bgcolor: 'background.paper',
                  color: 'tone.grey.fg',
                  borderColor: 'tone.grey.border',
                  '& .MuiChip-icon': { color: 'inherit', fontSize: 14 },
                }}
              />
            </Tooltip>
          )}

          <Tooltip title="Notifications">
            <IconButton
              onClick={(e) => {
                setBellAnchor(e.currentTarget);
                void bell.refresh(true);
              }}
              aria-label={bell.unread > 0 ? `Notifications, ${bell.unread} unread` : 'Notifications'}
              aria-haspopup="dialog"
              sx={{ width: 44, height: 44, borderRadius: '50%', color: 'text.secondary' }}
            >
              <Badge badgeContent={bell.unread > 0 ? countLabel(bell.unread) : 0} color="error" invisible={bell.unread <= 0}>
                <NotificationsNoneOutlinedIcon />
              </Badge>
            </IconButton>
          </Tooltip>

          <Tooltip title="Account">
            <IconButton
              onClick={(e) => setUserMenu(e.currentTarget)}
              aria-label="Open account menu"
              aria-haspopup="menu"
              aria-controls={userMenu ? 'pret-user-menu' : undefined}
              aria-expanded={Boolean(userMenu)}
              sx={{ width: 44, height: 44 }}
            >
              <UserAvatar name={user.displayName} seed={userSeed} />
            </IconButton>
          </Tooltip>
          <Menu
            id="pret-user-menu"
            anchorEl={userMenu}
            open={Boolean(userMenu)}
            onClose={() => setUserMenu(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          >
            <Box sx={{ px: 2, py: 1, minWidth: 200 }}>
              <Typography variant="body2" fontWeight={700}>
                {user.displayName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.roleLabel}
              </Typography>
            </Box>
            <Divider sx={{ my: 0.5 }} />
            <MenuItem component={NextLink} href="/account" onClick={() => setUserMenu(null)}>
              Account settings
            </MenuItem>
            {privacyNoticePublished && (
              <MenuItem component={NextLink} href="/privacy-notice" onClick={() => setUserMenu(null)}>
                Privacy notice
              </MenuItem>
            )}
            <Box component="form" action={async () => { await signOut(); window.location.assign('/login'); }}>
              <MenuItem component="button" type="submit" sx={{ width: '100%' }}>
                Sign out
              </MenuItem>
            </Box>
          </Menu>
        </Toolbar>
      </AppBar>

      {idleTimeoutMin ? <IdleTimeout idleTimeoutMin={idleTimeoutMin} userId={user.id ?? ''} /> : null}

      <NotificationPanel
        anchorEl={bellAnchor}
        onClose={() => setBellAnchor(null)}
        items={bell.panelItems}
        phone={isPhone}
        loading={bell.loading}
        error={bell.error}
        onRetry={() => void bell.refresh(true)}
        onMarkAllRead={() => void bell.markAll()}
        onOpen={(n) => void bell.open(n, () => setBellAnchor(null))}
      />

      {/* Below 1024 px: temporary drawer (hamburger / More). */}
      <Drawer
        id="pret-nav-drawer"
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        ModalProps={{ keepMounted: true }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': { width: theme.pret.drawerWidth, maxWidth: '85vw', boxSizing: 'border-box', boxShadow: 12, borderRight: 0 },
        }}
      >
        {drawer}
      </Drawer>

      {/* ≥ 1024 px: permanent, collapsible to a rail. */}
      <Drawer
        variant="permanent"
        open
        component="nav"
        aria-label="Main navigation"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            boxShadow: 'none',
            transition: theme.transitions.create('width', { duration: theme.transitions.duration.standard }),
          },
        }}
      >
        {drawer}
      </Drawer>

      <Box
        component="main"
        id="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          width: { md: `calc(100% - ${drawerWidth}px)` },
          pt: { xs: '72px', md: '80px' },
          px: { xs: 2, sm: 3, md: 4 },
          // Floating bar 64 + 12 gap + 12 breathing room + safe area (§8.3).
          pb: bottomBar ? 'calc(64px + 12px + 24px + env(safe-area-inset-bottom))' : { xs: 3, md: 4 },
        }}
      >
        <Box sx={{ maxWidth: theme.pret.contentMaxWidth, mx: 'auto' }}>
          {user.id ? (
            <React.Suspense fallback={null}>
              <UnsavedWorkRestorer userId={user.id} />
            </React.Suspense>
          ) : null}
          {children}
        </Box>
      </Box>

      {bottomBar && !keyboardOpen && (
        <Paper
          component="nav"
          aria-label="Quick navigation"
          elevation={0}
          sx={{
            position: 'fixed',
            left: 12,
            right: 12,
            bottom: 'calc(12px + env(safe-area-inset-bottom))',
            zIndex: theme.zIndex.appBar,
            borderRadius: '28px',
            bgcolor: 'background.paper',
            boxShadow: theme.pret.shadow.floating,
            px: 0.5,
          }}
        >
          <BottomNavigation showLabels value={bottomValue}>
            {bottomItems.map((b) => (
              <BottomNavigationAction
                key={b.value}
                value={b.value}
                label={b.label}
                component={NextLink}
                href={b.href}
                aria-current={bottomValue === b.value ? 'page' : undefined}
                icon={
                  <span className="pret-bb-pill">
                    {'badge' in b && b.badge ? (
                      <Badge badgeContent={countLabel(b.badge)} color="error" aria-label={`${b.badge} items awaiting approval`} sx={bbBadgeSx}>
                        <b.icon />
                      </Badge>
                    ) : (
                      <b.icon />
                    )}
                  </span>
                }
                sx={bottomActionSx}
              />
            ))}
            <BottomNavigationAction
              value="more"
              label="More"
              icon={
                <span className="pret-bb-pill">
                  <MoreHorizIcon />
                </span>
              }
              onClick={() => setMobileOpen(true)}
              aria-label="More — open the menu"
              sx={bottomActionSx}
            />
          </BottomNavigation>
        </Paper>
      )}
    </Box>
  );
}

// Selected slot: icon in a 60 × 32 violet pill, white icon (7.10 : 1); label #5B21B6 700 (§8.3).
const bottomActionSx = {
  '& .pret-bb-pill': {
    width: 60,
    height: 32,
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'background-color 150ms',
  },
  '& .pret-bb-pill .MuiSvgIcon-root': { fontSize: 22 },
  '&.Mui-selected .pret-bb-pill': { bgcolor: 'primary.main', color: '#FFFFFF' },
} as const;

const bbBadgeSx = { '& .MuiBadge-badge': { minWidth: 18, height: 18, fontSize: 11, px: 0.5, top: -2, right: -6 } } as const;

// ---------------------------------------------------------------------------

type DrawerContentProps = {
  sections: NavSection[];
  rail: boolean;
  user: AppShellProps['user'];
  version: string;
  badges: Partial<Record<NavBadgeKey, number>>;
  activeItemId?: string;
  activeLeafId?: string;
  onToggleRail?: () => void;
  privacyNoticePublished: boolean;
  helpHref?: string;
};

function DrawerContent({
  sections,
  rail,
  user,
  version,
  badges,
  activeItemId,
  activeLeafId,
  onToggleRail,
  privacyNoticePublished,
  helpHref,
}: DrawerContentProps) {
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const [flyout, setFlyout] = React.useState<{ anchor: HTMLElement; item: NavItem } | null>(null);

  // The section holding the active page starts open.
  React.useEffect(() => {
    if (activeItemId) setOpen((o) => (o[activeItemId] === undefined ? { ...o, [activeItemId]: true } : o));
  }, [activeItemId]);

  const badgeFor = (key?: NavBadgeKey) => (key ? badges[key] ?? 0 : 0);
  const seed = user.id ?? user.displayName;

  // §8.1: 46 px items, radius 14; the active item is the only saturated element in the rail.
  const itemSx = (active: boolean) => ({
    minHeight: { xs: 48, md: 46 },
    mx: rail ? 1.5 : 1,
    mb: 0.25,
    px: 1,
    gap: 1.5,
    justifyContent: rail ? 'center' : 'flex-start',
    color: 'text.primary',
    ...(active && {
      bgcolor: 'primary.main',
      color: '#FFFFFF',
      '&:hover': { bgcolor: 'primary.dark' },
    }),
  });

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Brand block */}
      <Box sx={{ px: rail ? 1 : 2.5, pt: 2.5, pb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent={rail ? 'center' : 'space-between'}>
          <NextLink href="/" aria-label="PRET home" style={{ display: 'inline-flex', lineHeight: 0 }}>
            {rail ? (
              // High-res PNG mark cropped from the logo Albert supplied 16/11/2026 (SVG still welcome).
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/brand/interact-mark.png" alt="Interact — Business through Technology" style={{ height: 32, width: 'auto' }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/brand/interact-logo.png"
                alt="Interact — Business through Technology"
                style={{ height: 28, width: 'auto', maxWidth: 140, objectFit: 'contain' }}
              />
            )}
          </NextLink>
          {!rail && (
            <Chip
              label={`v${version}`}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.6875rem', lineHeight: '16px', fontWeight: 600, color: 'text.secondary', borderColor: 'grey.300', '& .MuiChip-label': { px: 1 } }}
            />
          )}
        </Stack>
      </Box>

      {/* Greeting + role chip */}
      <Box sx={{ px: rail ? 1 : 2.5, pb: 1.5 }}>
        {rail ? (
          <Tooltip title={`${user.displayName} · ${user.roleLabel}`} placement="right">
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <UserAvatar name={user.displayName} seed={seed} size={36} />
            </Box>
          </Tooltip>
        ) : (
          <Stack direction="row" spacing={1.25} alignItems="center">
            <UserAvatar name={user.displayName} seed={seed} size={36} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="subtitle2" fontWeight={700} noWrap title={user.displayName}>
                Hi, {user.displayName}
              </Typography>
              <Box sx={{ mt: 0.25 }}>
                <RoleChip label={user.roleLabel} />
              </Box>
            </Box>
          </Stack>
        )}
      </Box>

      {onToggleRail && (
        <Box sx={{ display: 'flex', justifyContent: rail ? 'center' : 'flex-end', px: 1.5 }}>
          <Tooltip title={rail ? 'Expand menu' : 'Collapse menu'} placement="right">
            <IconButton size="small" onClick={onToggleRail} aria-label={rail ? 'Expand menu' : 'Collapse menu'} aria-pressed={rail} sx={{ color: 'text.secondary' }}>
              {rail ? <KeyboardDoubleArrowRightIcon fontSize="small" /> : <KeyboardDoubleArrowLeftIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 0.5 }}>
        {sections.map((section) => (
          <Box key={section.id} sx={{ mb: 0.5 }}>
            {section.heading &&
              (rail ? (
                <Divider sx={{ my: 1, mx: 2 }} />
              ) : (
                <Typography variant="overline" component="p" color="text.secondary" sx={{ px: 2.5, pt: 1.75, pb: 0.75 }}>
                  {section.heading}
                </Typography>
              ))}
            <List disablePadding>
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const hue = NAV_TILE[item.icon];
                const leafActive = item.href !== undefined && item.id === activeItemId && !activeLeafId;
                const parentActive = item.id === activeItemId && !!activeLeafId;
                const isOpen = !!open[item.id];
                const childBadge = (item.children ?? []).reduce((n, c) => n + badgeFor(c.badge), 0);
                const count = item.badge ? badgeFor(item.badge) : childBadge;

                const iconNode = (active: boolean) => (
                  <ListItemIcon sx={{ justifyContent: 'center' }}>
                    {rail && count > 0 ? (
                      <Badge variant="dot" color="error" overlap="rectangular">
                        <NavIconTile icon={Icon} hue={hue} active={active} />
                      </Badge>
                    ) : (
                      <NavIconTile icon={Icon} hue={hue} active={active} />
                    )}
                  </ListItemIcon>
                );
                const badgeNode = (onDark: boolean) =>
                  !rail && count > 0 ? <CountBadge count={count} label={`${count} items awaiting action`} onDark={onDark} /> : null;

                if (!item.children) {
                  const btn = (
                    <ListItemButton
                      component={NextLink}
                      href={item.href ?? '#'}
                      aria-current={leafActive ? 'page' : undefined}
                      aria-label={rail ? item.label : undefined}
                      className={leafActive ? 'pret-on-dark' : undefined}
                      sx={itemSx(leafActive)}
                    >
                      {iconNode(leafActive)}
                      {!rail && (
                        <ListItemText primary={item.label} slotProps={{ primary: { variant: 'subtitle2', fontWeight: leafActive ? 700 : 600, noWrap: true } }} />
                      )}
                      {badgeNode(leafActive)}
                    </ListItemButton>
                  );
                  return (
                    <li key={item.id}>
                      {rail ? (
                        <Tooltip title={item.label} placement="right">
                          {btn}
                        </Tooltip>
                      ) : (
                        btn
                      )}
                    </li>
                  );
                }

                // Expandable section
                const parentBtn = (
                  <ListItemButton
                    onClick={(e) => (rail ? setFlyout({ anchor: e.currentTarget, item }) : setOpen((o) => ({ ...o, [item.id]: !isOpen })))}
                    aria-expanded={rail ? Boolean(flyout && flyout.item.id === item.id) : isOpen}
                    aria-haspopup={rail ? 'menu' : undefined}
                    aria-label={rail ? item.label : undefined}
                    sx={{
                      ...itemSx(false),
                      ...(parentActive && { color: 'primary.dark' }),
                    }}
                  >
                    {iconNode(false)}
                    {!rail && (
                      <>
                        <ListItemText
                          primary={item.label}
                          slotProps={{ primary: { variant: 'subtitle2', fontWeight: parentActive ? 700 : 600, noWrap: true } }}
                        />
                        {badgeNode(false)}
                        {isOpen ? (
                          <ExpandLessIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
                        ) : (
                          <ExpandMoreIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
                        )}
                      </>
                    )}
                  </ListItemButton>
                );

                return (
                  <li key={item.id}>
                    {rail ? (
                      <Tooltip title={item.label} placement="right">
                        {parentBtn}
                      </Tooltip>
                    ) : (
                      parentBtn
                    )}
                    {!rail && (
                      <Collapse in={isOpen} timeout="auto" unmountOnExit>
                        <List disablePadding>
                          {item.children.map((leaf) => {
                            const active = leaf.id === activeLeafId && item.id === activeItemId;
                            const lc = badgeFor(leaf.badge);
                            return (
                              <li key={leaf.id}>
                                <ListItemButton
                                  component={NextLink}
                                  href={leaf.href}
                                  aria-current={active ? 'page' : undefined}
                                  className={active ? 'pret-on-dark' : undefined}
                                  sx={{ ...itemSx(active), minHeight: { xs: 48, md: 40 }, pl: 6.5 }}
                                >
                                  <ListItemText
                                    primary={leaf.label}
                                    slotProps={{ primary: { variant: 'body2', fontWeight: active ? 700 : 500, noWrap: true } }}
                                  />
                                  {lc > 0 && <CountBadge count={lc} label={`${lc} items awaiting action`} onDark={active} />}
                                </ListItemButton>
                              </li>
                            );
                          })}
                        </List>
                      </Collapse>
                    )}
                  </li>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {/* Rail flyout for expandable sections */}
      <Menu
        anchorEl={flyout?.anchor}
        open={Boolean(flyout)}
        onClose={() => setFlyout(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Typography variant="overline" component="p" color="text.secondary" sx={{ px: 2, py: 0.5 }}>
          {flyout?.item.label}
        </Typography>
        {flyout?.item.children?.map((leaf) => (
          <MenuItem
            key={leaf.id}
            component={NextLink}
            href={leaf.href}
            selected={leaf.id === activeLeafId}
            onClick={() => setFlyout(null)}
          >
            {leaf.label}
          </MenuItem>
        ))}
      </Menu>

      {!rail && (privacyNoticePublished || helpHref) && (
        <>
          <Divider sx={{ mx: 2 }} />
          <Stack direction="row" spacing={1} sx={{ px: 2.5, py: 1.5, color: 'text.secondary' }} divider={<span aria-hidden>·</span>}>
            {privacyNoticePublished && (
              <Link component={NextLink} href="/privacy-notice" variant="caption">
                Privacy notice
              </Link>
            )}
            {helpHref && (
              <Link href={helpHref} variant="caption">
                Help
              </Link>
            )}
          </Stack>
        </>
      )}
    </Box>
  );
}
