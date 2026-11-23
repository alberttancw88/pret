'use client';

// Employee / Manager Home (S-PT-01) — dashboard-visuals.md §2 and §3.1; Sunrise portal Home
// (theme-tokens.md §8.4): violet hero with greeting + pastel leave-balance tiles, 2 × 2 pastel
// quick-action tiles, then white portal cards. The hero exists ONLY here (calm rule 2).
// Phone-first single column at 360 px; desktop: hero full width, then 12-col (left 8 / right 4).
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import EventAvailableOutlinedIcon from '@mui/icons-material/EventAvailableOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SwapHorizOutlinedIcon from '@mui/icons-material/SwapHorizOutlined';
import RequestQuoteOutlinedIcon from '@mui/icons-material/RequestQuoteOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import StatusChip, { chipBaseSx, chipSx, type StatusValue } from '../StatusChip';
import type { TileName } from '@/theme/augment';
import { toToneName } from '@/theme/palette';
import MoneyText from '../MoneyText';
import DateText from '../DateText';
import EmptyState from '../EmptyState';
import KpiTile from './KpiTile';
import { formatDate, formatDays } from '@/lib/format';

export type LeaveBalance = {
  id: string;
  name: string;
  /** null = "Approval only" type (no number shown). */
  available: number | null;
  earnedToDate?: number;
  allowedNegative?: number;
  expiring?: { days: number; date: string };
  colorIndex: number;
  /** LT32 colour (W2-004); falls back to the palette index. */
  colour?: string;
  /** tile target (W2-004: the P6 ledger for that type). */
  href?: string;
  /** label shown instead of a number for types without a balance ("98 consecutive days per confinement"). */
  noBalanceLabel?: string;
};

export type PendingItem =
  | { ref: string; href: string; label: string; set: 'leave'; status: StatusValue<'leave'> }
  | { ref: string; href: string; label: string; set: 'claim'; status: StatusValue<'claim'> }
  | { ref: string; href: string; label: string; set: 'changeRequest'; status: StatusValue<'changeRequest'> }
  | { ref: string; href: string; label: string; set: 'credit'; status: StatusValue<'credit'> }
  /** W2-004 live items: label + tone from the server. */
  | { ref: string; href: string; label: string; set: 'generic'; status: string; tone: string };

export type HomeData = {
  balances: LeaveBalance[];
  pendingClaims: { count: number; amount: number | string };
  pendingItems: PendingItem[];
  upcomingLeave: { id: string; type: string; colorIndex: number; from: string; to: string; days: number | string; colour?: string; href?: string }[];
  holidays: { date: string; name: string; weekday: string; state: string }[];
  /** "Holiday calendar for {year} not yet published" (W2-004 Q-F3) */
  holidaysNote?: string | null;
  recentClaims: { ref: string; href: string; title: string; total: number | string; status: StatusValue<'claim'> }[];
  /** null values render "—" (value not available). */
  manager: { approvals: number; onLeaveToday: number; onLeaveWeek: number; probationDue: number | null; teamClaimsSubmitted: number | null } | null;
};

export type EmployeeHomeProps = {
  displayName: string;
  roleLabel: string;
  data: HomeData;
  placeholder?: boolean;
  /** Claims parts (pending claims, recent claims) arrive with W2-005. */
  claimsDeferred?: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Phone pass (W2-006): list-row links get a 44 px tall tap area (PRD §8.4). */
const TAP_LINK = { display: 'inline-flex', alignItems: 'center', minHeight: 44 } as const;

function CardTitle({ title, href, linkLabel = 'See all' }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {href && (
        <Link component={NextLink} href={href} variant="body2" sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
          {linkLabel}
          <ChevronRightIcon aria-hidden sx={{ fontSize: 16 }} />
        </Link>
      )}
    </Stack>
  );
}

const BALANCE_HUES: TileName[] = ['lavender', 'mint', 'peach', 'sky', 'rose'];

/** Pastel balance tile inside the hero (§8.4 / §8.5): tile bg, one ink colour for all text. */
function BalanceTile({ b, hue }: { b: LeaveBalance; hue: TileName }) {
  const ink = `tile.${hue}.ink`;
  return (
    <Card sx={{ height: '100%', scrollSnapAlign: 'start', bgcolor: `tile.${hue}.bg`, border: 'none', borderRadius: '20px' }}>
      <CardActionArea component={NextLink} href={b.href ?? '/my/leave/balances'} sx={{ height: '100%', alignItems: 'stretch' }}>
        <Box sx={{ px: { xs: 1.75, md: 2.25 }, py: { xs: 1.5, md: 2 }, minWidth: 0, color: ink }}>
          <Stack direction="row" spacing={0.75} alignItems="center">
            <Box
              aria-hidden
              sx={(t) => ({ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: b.colour ?? t.palette.leaveType[b.colorIndex % t.palette.leaveType.length] })}
            />
            <Typography variant="caption" component="p" noWrap sx={{ fontWeight: 700, color: ink }}>
              {b.name}
            </Typography>
          </Stack>
          {b.available === null ? (
            <Typography variant="body2" sx={{ mt: 1.5, color: ink, fontWeight: 600 }}>
              {b.noBalanceLabel ?? 'Approval only'}
            </Typography>
          ) : (
            <>
              <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ mt: 0.5 }}>
                <Typography variant="kpi" component="p" sx={{ color: b.available < 0 ? 'error.dark' : ink }}>
                  {`${b.available < 0 ? '−' : ''}${Math.abs(b.available).toFixed(1)}`}
                </Typography>
                <Typography variant="body2" fontWeight={600} sx={{ color: ink }}>
                  d
                </Typography>
              </Stack>
              <Typography variant="caption" component="p" sx={{ color: ink }}>
                Available
              </Typography>
              {b.available < 0 && b.allowedNegative !== undefined && (
                <Typography variant="caption" component="p" sx={{ color: ink }}>
                  Allowed down to −{b.allowedNegative.toFixed(1)}
                </Typography>
              )}
              {b.earnedToDate !== undefined && (
                <Typography variant="caption" component="p" sx={{ color: ink }}>
                  {b.earnedToDate.toFixed(1)} earned to date
                </Typography>
              )}
            </>
          )}
          {b.expiring && (
            <Stack direction="row" spacing={0.75} sx={{ mt: 1, px: 1, py: 0.75, borderRadius: '12px', bgcolor: 'tone.warning.bg', color: 'tone.warning.fg' }}>
              <WarningAmberIcon aria-hidden sx={{ fontSize: 16, mt: '1px' }} />
              <Typography variant="caption" component="p">
                {b.expiring.days.toFixed(1)} expires {formatDate(b.expiring.date)}
              </Typography>
            </Stack>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}

/** "Monday · 23/11/2026" in Malaysia time. */
function todayLine() {
  const now = new Date();
  const weekday = new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'Asia/Kuala_Lumpur' }).format(now);
  return `${weekday} · ${formatDate(now)}`;
}

/** Portal Home hero (§8.4): gradient, greeting, leave balances. */
function PortalHero({ displayName, roleLabel, balances }: { displayName: string; roleLabel: string; balances: LeaveBalance[] }) {
  return (
    <Box
      component="section"
      aria-label="Greeting and leave balances"
      className="pret-on-dark"
      sx={(t) => ({
        position: 'relative',
        overflow: 'hidden',
        borderRadius: { xs: '26px', md: '28px' },
        background: t.palette.hero.gradient,
        boxShadow: t.palette.hero.shadow,
        color: '#FFFFFF',
        px: { xs: 2, md: 3 },
        pt: { xs: 2.25, md: 3 },
        pb: { xs: 2, md: 3 },
      })}
    >
      {/* Decorative circle only — never under text beyond the 5.84 : 1 worst case. */}
      <Box
        aria-hidden
        sx={(t) => ({ position: 'absolute', top: -40, right: -40, width: 140, height: 140, borderRadius: '50%', bgcolor: t.palette.hero.decor, pointerEvents: 'none' })}
      />
      <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1} sx={{ position: 'relative' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={(t) => ({ color: t.palette.hero.subtext })} suppressHydrationWarning>
            {todayLine()}
          </Typography>
          <Typography variant="h3" component="h2" sx={{ color: '#FFFFFF', mt: 0.25, overflowWrap: 'anywhere', '@media (max-width:599.95px)': { fontSize: '1.5rem', lineHeight: '2rem' } }}>
            Hi, {displayName}
          </Typography>
        </Box>
        <Chip
          label={roleLabel}
          size="small"
          sx={[chipSx('violet', 'filled'), chipBaseSx(true), { flexShrink: 0, mt: 0.5 }]}
        />
      </Stack>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: { xs: 1.5, md: 2.5 }, mb: 1, position: 'relative' }}>
        <Typography variant="h6" component="h3" sx={{ color: '#FFFFFF' }}>
          Leave balances
        </Typography>
        <Link
          component={NextLink}
          href="/my/leave/balances"
          underline="always"
          variant="body2"
          sx={{ color: '#FFFFFF', display: 'inline-flex', alignItems: 'center', minHeight: 44, px: 0.5 }}
        >
          All
          <ChevronRightIcon aria-hidden sx={{ fontSize: 16 }} />
        </Link>
      </Stack>

      {balances.length === 0 ? (
        <Box sx={{ bgcolor: 'background.paper', color: 'text.primary', borderRadius: '20px', position: 'relative' }}>
          <EmptyState title="No leave types available yet — contact HR" minHeight={120} />
        </Box>
      ) : (
        <Box
          sx={{
            position: 'relative',
            display: { xs: 'flex', md: 'grid' },
            gridTemplateColumns: { md: 'repeat(3, minmax(0, 1fr))' },
            gap: { xs: 1.25, md: 2 },
            overflowX: { xs: 'auto', md: 'visible' },
            scrollSnapType: { xs: 'x mandatory', md: 'none' },
            // Phone: tiles bleed to the hero edge and scroll sideways.
            mx: { xs: -2, md: 0 },
            px: { xs: 2, md: 0 },
            pb: { xs: 0.5, md: 0 },
            scrollbarWidth: 'none',
            '& > *': { flex: { xs: '0 0 148px', md: 'initial' } },
          }}
        >
          {balances.map((b, i) => (
            <BalanceTile key={b.id} b={b} hue={BALANCE_HUES[i % BALANCE_HUES.length]} />
          ))}
        </Box>
      )}
    </Box>
  );
}

/** 2 × 2 pastel quick-action tiles (§8.4): lavender, mint, peach, sky; label in the tile ink. */
function QuickActionTile({ href, label, icon: Icon, hue, disabledReason }: { href?: string; label: string; icon: React.ElementType; hue: TileName; disabledReason?: string }) {
  const body = (
    <Stack spacing={1} justifyContent="space-between" sx={{ p: 1.75, minHeight: 84, height: '100%', alignItems: 'flex-start' }}>
      <Box
        aria-hidden
        sx={{ width: 36, height: 36, borderRadius: '12px', bgcolor: 'rgba(255,255,255,0.7)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon sx={{ fontSize: 20 }} />
      </Box>
      <Typography variant="subtitle2" component="span" sx={{ fontWeight: 700, lineHeight: '18px', color: 'inherit' }}>
        {label}
      </Typography>
    </Stack>
  );
  const sx = { height: '100%', bgcolor: `tile.${hue}.bg`, color: `tile.${hue}.ink`, border: 'none', borderRadius: '20px' } as const;
  if (disabledReason || !href) {
    return (
      <Card sx={{ ...sx, opacity: 0.6, cursor: 'not-allowed' }} title={disabledReason} aria-disabled="true" role="group" aria-label={`${label} (${disabledReason ?? 'unavailable'})`}>
        {body}
      </Card>
    );
  }
  return (
    <Card sx={{ ...sx, transition: 'box-shadow 150ms', '&:hover': { boxShadow: 4 } }}>
      <CardActionArea component={NextLink} href={href} sx={{ height: '100%' }}>
        {body}
      </CardActionArea>
    </Card>
  );
}

function QuickActions() {
  return (
    <Box component="section" aria-label="Quick actions">
      <Typography variant="h6" component="h2" sx={{ mb: 1.25 }}>
        Quick actions
      </Typography>
      <Grid container spacing={1.25}>
        <Grid size={6}>
          <QuickActionTile href="/my/leave/apply" label="Apply leave" icon={EventAvailableOutlinedIcon} hue="lavender" />
        </Grid>
        <Grid size={6}>
          <QuickActionTile href="/my/claims/new" label="New claim" icon={ReceiptLongOutlinedIcon} hue="mint" />
        </Grid>
        <Grid size={6}>
          <QuickActionTile href="/my/leave/credits/new" label="Request replacement credit" icon={SwapHorizOutlinedIcon} hue="peach" />
        </Grid>
        <Grid size={6}>
          {/* R1.1: payslips. Shown disabled-with-reason until payroll ships. */}
          <QuickActionTile label="My payslips" icon={RequestQuoteOutlinedIcon} hue="sky" disabledReason="Payslips arrive with Release 1.1" />
        </Grid>
      </Grid>
    </Box>
  );
}

function ManagerPanel({ m }: { m: NonNullable<HomeData['manager']> }) {
  const rows = [
    { label: 'Approvals waiting', value: m.approvals, href: '/approvals', accent: m.approvals > 0 ? 'primary.main' : 'grey.300' },
    { label: 'Team on leave today', value: m.onLeaveToday, href: '/team/leave?when=today', accent: 'grey.300' },
    { label: 'Team on leave this week', value: m.onLeaveWeek, href: '/team/leave?when=week', accent: 'grey.300' },
    { label: 'Probation due in team', value: m.probationDue, href: '/team', accent: (m.probationDue ?? 0) > 0 ? 'warning.main' : 'grey.300' },
    { label: 'Team claims submitted', value: m.teamClaimsSubmitted, href: '/approvals?tab=claims', accent: (m.teamClaimsSubmitted ?? 0) > 0 ? 'primary.main' : 'grey.300' },
  ];
  return (
    <Card variant="portal">
      <CardContent sx={{ pb: '8px !important' }}>
        <CardTitle title="Manager" />
        <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
          {rows.map((r) => (
            <li key={r.label}>
              <Box
                component={NextLink}
                href={r.href}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  minHeight: 56,
                  color: 'text.primary',
                  textDecoration: 'none',
                  borderTop: '1px solid',
                  borderColor: 'rowDivider',
                  borderRadius: '10px',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box aria-hidden sx={{ width: 4, alignSelf: 'stretch', my: 1.5, borderRadius: 2, bgcolor: r.accent }} />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {r.label}
                </Typography>
                <Typography className="pret-tnum" sx={{ fontSize: '1.25rem', lineHeight: 1.4, fontWeight: 800, color: r.value ? 'text.primary' : 'text.secondary' }}>
                  {r.value ?? '—'}
                </Typography>
                <ChevronRightIcon aria-hidden sx={{ fontSize: 18, color: 'primary.dark', mr: 0.5 }} />
              </Box>
            </li>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

export default function EmployeeHome({ displayName, roleLabel, data, placeholder, claimsDeferred }: EmployeeHomeProps) {
  const pendingChip = (p: PendingItem) => {
    switch (p.set) {
      case 'leave':
        return <StatusChip set="leave" value={p.status} />;
      case 'claim':
        return <StatusChip set="claim" value={p.status} />;
      case 'changeRequest':
        return <StatusChip set="changeRequest" value={p.status} />;
      case 'credit':
        return <StatusChip set="credit" value={p.status} />;
      case 'generic':
        return (
          <Chip
            size="small"
            label={p.status}
            sx={[chipSx(toToneName(p.tone), 'filled'), chipBaseSx()]}
          />
        );
    }
  };

  return (
    <Stack spacing={3}>
      {placeholder && (
        <Alert severity="info">
          Placeholder data for layout review only (W2-001). Real balances, claims and approvals arrive with the Leave, Claims and Portal work items.
        </Alert>
      )}

      <PortalHero displayName={displayName} roleLabel={roleLabel} balances={data.balances} />

      <Grid container spacing={3}>
        {/* Left 8 */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={3}>
            {/* Phone/tablet: quick actions directly under balances (one tap from Home). */}
            <Box sx={{ display: { xs: 'block', md: 'none' } }}>
              <QuickActions />
            </Box>
            {data.manager && (
              <Box sx={{ display: { xs: 'block', md: 'none' } }}>
                <ManagerPanel m={data.manager} />
              </Box>
            )}

            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 5 }}>
                {claimsDeferred ? (
                  <KpiTile label="Pending claims" value="—" tone="grey" subLine="Claims arrive with W2-005" />
                ) : (
                  <KpiTile
                    label="Pending claims"
                    value={data.pendingClaims.count}
                    tone={data.pendingClaims.count > 0 ? 'warning' : 'grey'}
                    href="/my/claims?statuses=submitted"
                    subLine={
                      <>
                        <MoneyText amount={data.pendingClaims.amount} /> awaiting approval
                      </>
                    }
                  />
                )}
              </Grid>
              <Grid size={{ xs: 12, sm: 7 }}>
                <Card variant="portal" sx={{ height: '100%' }}>
                  <CardContent>
                    <CardTitle title="My pending items" href="/my/leave?statuses=pending,cancellation_pending" />
                    {data.pendingItems.length === 0 ? (
                      <Typography variant="body2" color="text.secondary">
                        Nothing pending
                      </Typography>
                    ) : (
                      <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                        {data.pendingItems.slice(0, 5).map((p) => (
                          <Stack
                            component="li"
                            key={p.ref}
                            direction="row"
                            alignItems="center"
                            spacing={1}
                            sx={{ minHeight: 56, borderTop: '1px solid', borderColor: 'rowDivider' }}
                          >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Link component={NextLink} href={p.href} variant="body2" className="pret-tnum" sx={TAP_LINK}>
                                {p.ref}
                              </Link>
                              <Typography variant="caption" color="text.secondary" component="p" noWrap>
                                {p.label}
                              </Typography>
                            </Box>
                            {pendingChip(p)}
                          </Stack>
                        ))}
                      </Box>
                    )}
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            <Card variant="portal">
              <CardContent>
                <CardTitle title="Upcoming leave" href="/my/leave" />
                {data.upcomingLeave.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No upcoming leave.
                  </Typography>
                ) : (
                  <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                    {data.upcomingLeave.slice(0, 3).map((l) => (
                      <Stack
                        component="li"
                        key={l.id}
                        direction="row"
                        alignItems="center"
                        spacing={1.5}
                        sx={{ minHeight: 48, borderTop: '1px solid', borderColor: 'rowDivider' }}
                      >
                        <Box
                          aria-hidden
                          sx={(t) => ({ width: 10, height: 10, borderRadius: '50%', bgcolor: l.colour ?? t.palette.leaveType[l.colorIndex % t.palette.leaveType.length] })}
                        />
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          {l.href ? (
                            <Link component={NextLink} href={l.href} sx={TAP_LINK}>
                              {l.type}
                            </Link>
                          ) : (
                            l.type
                          )}{' '}
                          · <DateText value={l.from} /> – <DateText value={l.to} />
                        </Typography>
                        <Typography variant="body2" className="pret-tnum" color="text.secondary">
                          {formatDays(l.days)}
                        </Typography>
                      </Stack>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Stack>
        </Grid>

        {/* Right 4 */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={3}>
            <Box sx={{ display: { xs: 'none', md: 'block' } }}>
              <QuickActions />
            </Box>
            {data.manager && (
              <Box sx={{ display: { xs: 'none', md: 'block' } }}>
                <ManagerPanel m={data.manager} />
              </Box>
            )}

            <Card variant="portal">
              <CardContent>
                <CardTitle title="Public holidays" href="/my/holidays" />
                {data.holidays.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {data.holidaysNote ?? 'The calendar has not been published yet.'}
                  </Typography>
                ) : (
                  <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                    {data.holidays.slice(0, 3).map((h) => {
                      const [y, m, d] = h.date.split('-').map(Number);
                      return (
                        <Stack component="li" key={h.date + h.name} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1 }}>
                          <Box
                            aria-hidden
                            sx={{
                              width: 40,
                              height: 40,
                              flexShrink: 0,
                              borderRadius: '12px',
                              bgcolor: 'tile.lavender.bg',
                              color: 'tile.lavender.ink',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <Typography sx={{ fontWeight: 700, fontSize: '1rem', lineHeight: 1.1 }} className="pret-tnum">
                              {d}
                            </Typography>
                            <Typography variant="caption" sx={{ lineHeight: 1.1, fontSize: '0.6875rem' }}>
                              {MONTHS[m - 1]}
                            </Typography>
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography variant="body2" fontWeight={600}>
                              {h.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {h.weekday}, {formatDate(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)}
                            </Typography>
                          </Box>
                          <Chip label={h.state} size="small" sx={[chipSx('grey', 'outlined'), chipBaseSx()]} />
                        </Stack>
                      );
                    })}
                  </Box>
                )}
              </CardContent>
            </Card>

            <Card variant="portal">
              <CardContent>
                <CardTitle title="Recent claims" href={claimsDeferred ? undefined : '/my/claims'} />
                {claimsDeferred ? (
                  <Typography variant="body2" color="text.secondary">
                    Claims arrive with the claims module (W2-005).
                  </Typography>
                ) : data.recentClaims.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No claims yet.
                  </Typography>
                ) : (
                  <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0 }}>
                    {data.recentClaims.slice(0, 3).map((c) => (
                      <Stack
                        component="li"
                        key={c.ref}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ minHeight: 56, borderTop: '1px solid', borderColor: 'rowDivider' }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Link component={NextLink} href={c.href} variant="body2" className="pret-tnum" sx={TAP_LINK}>
                            {c.ref}
                          </Link>
                          <Typography variant="caption" color="text.secondary" component="p" noWrap>
                            {c.title}
                          </Typography>
                        </Box>
                        <Stack alignItems="flex-end" spacing={0.5}>
                          <Typography variant="body2" fontWeight={600}>
                            <MoneyText amount={c.total} />
                          </Typography>
                          <StatusChip set="claim" value={c.status} />
                        </Stack>
                      </Stack>
                    ))}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
