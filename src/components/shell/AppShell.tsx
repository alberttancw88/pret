'use client';

// PRET app shell — components.md §9, wireframes.md §0.1, IA §2.
// AppBar (top) + Drawer (left: permanent ≥ 1024 px, collapsible to a 72 px rail;
// temporary below 1024 px) + main + BottomNavigation (phone < 600 px, employee users).
// `sections` arrive already filtered by role on the server (buildNav), so unauthorised
// items are absent from the DOM. That is NOT access control — every page calls requireUser.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
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
import { findActive, resolveTitle, type NavBadgeKey, type NavIconKey, type NavItem, type NavSection } from './nav';
import { PageTitleProvider, usePageTitleOverride } from './PageTitle';
import NotificationPanel, { type ShellNotification } from './NotificationPanel';
import IdleTimeout from './IdleTimeout';

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

const COLLAPSE_KEY = 'pret.nav.collapsed';
const BORDER = '#E4E6EC';

export type AppShellProps = {
  sections: NavSection[];
  user: { displayName: string; roleLabel: string; isExternal: boolean };
  version: string;
  /** Show the phone bottom bar (employee users only, IA §2). */
  showBottomBar: boolean;
  /** Approvals slot in the bottom bar (MGR/ADM/SA); otherwise Profile. */
  canApprove: boolean;
  badges?: Partial<Record<NavBadgeKey, number>>;
  notifications?: ShellNotification[];
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
    { value: 'claims', label: 'Claims', href: '/claims', icon: ReceiptLongOutlinedIcon, match: ['/claims'] },
    canApprove
      ? { value: 'approvals', label: 'Approvals', href: '/approvals', icon: TaskAltOutlinedIcon, match: ['/approvals'], badge: badges.approvals ?? 0 }
      : { value: 'profile', label: 'Profile', href: '/my/profile', icon: PersonOutlineIcon, match: ['/my'] },
  ];
  const bottomValue =
    bottomItems.find((b) => b.match.some((m) => pathname === m || pathname.startsWith(m + '/')))?.value ?? (mobileOpen ? 'more' : false);
  const bottomBar = showBottomBar && isPhone;

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      <AppBar
        position="fixed"
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          transition: theme.transitions.create(['width', 'margin'], { duration: theme.transitions.duration.standard }),
        }}
      >
        <Toolbar sx={{ gap: 1, minHeight: { xs: 56, md: 64 }, px: { xs: 1, sm: 2, md: 3 } }}>
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
                      <Link component={NextLink} href={c.href} sx={{ fontWeight: 400 }}>
                        {c.label}
                      </Link>
                    ) : (
                      c.label
                    )}
                    {' ▸ '}
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
                  color: '#374151',
                  borderColor: '#8F95A3',
                  '& .MuiChip-icon': { color: 'inherit', fontSize: 14 },
                }}
              />
            </Tooltip>
          )}

          <Tooltip title="Notifications">
            <IconButton
              onClick={(e) => setBellAnchor(e.currentTarget)}
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
              aria-haspopup="dialog"
            >
              <Badge badgeContent={unreadCount > 0 ? countLabel(unreadCount) : 0} color="error" invisible={unreadCount <= 0}>
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
            >
              <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.brand', fontSize: '0.8125rem', fontWeight: 600 }}>
                <span aria-hidden>{initials(user.displayName)}</span>
              </Avatar>
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
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="body2" fontWeight={600}>
                {user.displayName}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {user.roleLabel}
              </Typography>
            </Box>
            <Divider />
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

      {idleTimeoutMin ? <IdleTimeout idleTimeoutMin={idleTimeoutMin} /> : null}

      <NotificationPanel
        anchorEl={bellAnchor}
        onClose={() => setBellAnchor(null)}
        items={notifications}
        phone={isPhone}
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
          '& .MuiDrawer-paper': { width: theme.pret.drawerWidth, maxWidth: '85vw', boxSizing: 'border-box', boxShadow: 8 },
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
          pt: { xs: '72px', md: '88px' },
          px: { xs: 2, sm: 3 },
          pb: bottomBar ? 'calc(56px + 24px + env(safe-area-inset-bottom))' : 3,
        }}
      >
        <Box sx={{ maxWidth: theme.pret.contentMaxWidth, mx: 'auto' }}>{children}</Box>
      </Box>

      {bottomBar && (
        <Paper
          component="nav"
          aria-label="Quick navigation"
          square
          elevation={0}
          sx={{
            position: 'fixed',
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: theme.zIndex.appBar,
            borderTop: `1px solid ${BORDER}`,
            pb: 'env(safe-area-inset-bottom)',
          }}
        >
          <BottomNavigation showLabels value={bottomValue} sx={{ height: 56 }}>
            {bottomItems.map((b) => (
              <BottomNavigationAction
                key={b.value}
                value={b.value}
                label={b.label}
                component={NextLink}
                href={b.href}
                aria-current={bottomValue === b.value ? 'page' : undefined}
                icon={
                  'badge' in b && b.badge ? (
                    <Badge badgeContent={countLabel(b.badge)} color="error" aria-label={`${b.badge} items awaiting approval`}>
                      <b.icon />
                    </Badge>
                  ) : (
                    <b.icon />
                  )
                }
                sx={bottomActionSx}
              />
            ))}
            <BottomNavigationAction
              value="more"
              label="More"
              icon={<MoreHorizIcon />}
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

const bottomActionSx = {
  position: 'relative',
  minWidth: 64,
  '&.Mui-selected::before': {
    content: '""',
    position: 'absolute',
    top: 0,
    left: '20%',
    right: '20%',
    height: 3,
    borderRadius: '0 0 3px 3px',
    backgroundColor: '#5A5FF2',
  },
} as const;

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
  const external = user.isExternal;

  const itemSx = (active: boolean) => ({
    minHeight: { xs: 48, md: 44 },
    mx: 1,
    mb: 0.25,
    px: rail ? 0 : 1.5,
    justifyContent: rail ? 'center' : 'flex-start',
    color: 'text.primary',
    '& .MuiListItemIcon-root': { color: '#5F6673' },
    ...(active && {
      bgcolor: 'primary.main',
      color: '#FFFFFF',
      '& .MuiListItemIcon-root': { color: '#FFFFFF' },
      '&:hover': { bgcolor: 'primary.dark' },
    }),
  });

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Brand block */}
      <Box sx={{ px: rail ? 1 : 2.5, pt: 2, pb: 1.5 }}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent={rail ? 'center' : 'flex-start'}>
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
                style={{ height: 32, width: 'auto', maxWidth: 140, objectFit: 'contain' }}
              />
            )}
          </NextLink>
          {!rail && (
            <Chip
              label={`v${version}`}
              size="small"
              variant="outlined"
              sx={{ height: 20, fontSize: '0.6875rem', lineHeight: 1.455, color: '#374151', borderColor: '#8F95A3' }}
            />
          )}
        </Stack>
      </Box>

      {/* Greeting + role chip */}
      <Box sx={{ px: rail ? 1 : 2.5, pb: 1.5 }}>
        {rail ? (
          <Tooltip title={`${user.displayName} · ${user.roleLabel}`} placement="right">
            <Avatar sx={{ width: 32, height: 32, mx: 'auto', bgcolor: 'primary.brand', fontSize: '0.8125rem', fontWeight: 600 }}>
              <span aria-hidden>{initials(user.displayName)}</span>
            </Avatar>
          </Tooltip>
        ) : (
          <Stack direction="row" spacing={1.25} alignItems="center">
            <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.brand', fontSize: '0.8125rem', fontWeight: 600 }}>
              <span aria-hidden>{initials(user.displayName)}</span>
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} noWrap title={user.displayName}>
                Hi, {user.displayName}
              </Typography>
              <Chip
                label={user.roleLabel}
                size="small"
                variant={external ? 'outlined' : 'filled'}
                sx={{
                  height: 20,
                  fontSize: '0.6875rem',
                  lineHeight: 1.455,
                  mt: 0.25,
                  '& .MuiChip-label': { px: 1 },
                  ...(external
                    ? { color: '#3A3FBF', borderColor: '#5A5FF2', bgcolor: 'transparent' }
                    : { color: '#FFFFFF', bgcolor: '#5A5FF2' }),
                }}
              />
            </Box>
          </Stack>
        )}
      </Box>

      {onToggleRail && (
        <Box sx={{ display: 'flex', justifyContent: rail ? 'center' : 'flex-end', px: 1 }}>
          <Tooltip title={rail ? 'Expand menu' : 'Collapse menu'} placement="right">
            <IconButton size="small" onClick={onToggleRail} aria-label={rail ? 'Expand menu' : 'Collapse menu'} aria-pressed={rail}>
              {rail ? <KeyboardDoubleArrowRightIcon fontSize="small" /> : <KeyboardDoubleArrowLeftIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
      )}
      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', py: 1 }}>
        {sections.map((section) => (
          <Box key={section.id} sx={{ mb: 0.5 }}>
            {section.heading &&
              (rail ? (
                <Divider sx={{ my: 1, mx: 1.5 }} />
              ) : (
                <Typography variant="overline" component="p" color="text.secondary" sx={{ px: 2.5, pt: 1.5, pb: 0.5 }}>
                  {section.heading}
                </Typography>
              ))}
            <List disablePadding>
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const leafActive = item.href !== undefined && item.id === activeItemId && !activeLeafId;
                const parentActive = item.id === activeItemId && !!activeLeafId;
                const isOpen = !!open[item.id];
                const childBadge = (item.children ?? []).reduce((n, c) => n + badgeFor(c.badge), 0);
                const count = item.badge ? badgeFor(item.badge) : childBadge;

                const iconNode = (
                  <ListItemIcon sx={{ minWidth: rail ? 0 : 36, justifyContent: 'center' }}>
                    {rail && count > 0 ? (
                      <Badge variant="dot" color="error">
                        <Icon sx={{ fontSize: 20 }} />
                      </Badge>
                    ) : (
                      <Icon sx={{ fontSize: 20 }} />
                    )}
                  </ListItemIcon>
                );
                const badgeNode =
                  !rail && count > 0 ? (
                    <Box
                      component="span"
                      aria-label={`${count} items awaiting action`}
                      sx={{
                        ml: 1,
                        minWidth: 20,
                        height: 20,
                        px: 0.75,
                        borderRadius: 10,
                        bgcolor: '#D32F2F',
                        color: '#FFFFFF',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        lineHeight: '20px',
                        textAlign: 'center',
                      }}
                    >
                      {countLabel(count)}
                    </Box>
                  ) : null;

                if (!item.children) {
                  const btn = (
                    <ListItemButton
                      component={NextLink}
                      href={item.href ?? '#'}
                      aria-current={leafActive ? 'page' : undefined}
                      aria-label={rail ? item.label : undefined}
                      sx={itemSx(leafActive)}
                    >
                      {iconNode}
                      {!rail && (
                        <ListItemText primary={item.label} slotProps={{ primary: { variant: 'subtitle2', fontWeight: leafActive ? 600 : 500, noWrap: true } }} />
                      )}
                      {badgeNode}
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
                      ...(parentActive && { color: '#4548C9', '& .MuiListItemIcon-root': { color: '#4548C9' } }),
                    }}
                  >
                    {iconNode}
                    {!rail && (
                      <>
                        <ListItemText
                          primary={item.label}
                          slotProps={{ primary: { variant: 'subtitle2', fontWeight: parentActive ? 700 : 500, noWrap: true } }}
                        />
                        {badgeNode}
                        {isOpen ? <ExpandLessIcon fontSize="small" aria-hidden /> : <ExpandMoreIcon fontSize="small" aria-hidden />}
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
                                  sx={{ ...itemSx(active), minHeight: { xs: 48, md: 40 }, pl: 5.5 }}
                                >
                                  <ListItemText
                                    primary={leaf.label}
                                    slotProps={{ primary: { variant: 'body2', fontWeight: active ? 600 : 400, noWrap: true } }}
                                  />
                                  {lc > 0 && (
                                    <Box
                                      component="span"
                                      aria-label={`${lc} items awaiting action`}
                                      sx={{
                                        ml: 1,
                                        minWidth: 20,
                                        height: 20,
                                        px: 0.75,
                                        borderRadius: 10,
                                        bgcolor: '#D32F2F',
                                        color: '#FFFFFF',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        lineHeight: '20px',
                                        textAlign: 'center',
                                      }}
                                    >
                                      {countLabel(lc)}
                                    </Box>
                                  )}
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
          <Divider />
          <Stack direction="row" spacing={1} sx={{ px: 2.5, py: 1.5 }} divider={<span aria-hidden>·</span>}>
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
