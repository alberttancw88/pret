'use client';

// Employee / Manager Home (S-PT-01) — dashboard-visuals.md §2 and §3.1.
// Phone-first single column at 360 px; desktop 12-col (left 8 / right 4).
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
import StatusChip, { type StatusValue } from '../StatusChip';
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
};

export type PendingItem =
  | { ref: string; href: string; label: string; set: 'leave'; status: StatusValue<'leave'> }
  | { ref: string; href: string; label: string; set: 'claim'; status: StatusValue<'claim'> }
  | { ref: string; href: string; label: string; set: 'changeRequest'; status: StatusValue<'changeRequest'> }
  | { ref: string; href: string; label: string; set: 'credit'; status: StatusValue<'credit'> };

export type HomeData = {
  balances: LeaveBalance[];
  pendingClaims: { count: number; amount: number };
  pendingItems: PendingItem[];
  upcomingLeave: { id: string; type: string; colorIndex: number; from: string; to: string; days: number }[];
  holidays: { date: string; name: string; weekday: string; state: string }[];
  recentClaims: { ref: string; href: string; title: string; total: number; status: StatusValue<'claim'> }[];
  manager: { approvals: number; onLeaveToday: number; onLeaveWeek: number; probationDue: number; teamClaimsSubmitted: number } | null;
};

export type EmployeeHomeProps = {
  displayName: string;
  roleLabel: string;
  data: HomeData;
  placeholder?: boolean;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function BalanceCard({ b }: { b: LeaveBalance }) {
  return (
    <Card sx={{ height: '100%', scrollSnapAlign: 'start' }}>
      <CardActionArea component={NextLink} href={`/leave/balances?type=${encodeURIComponent(b.id)}`} sx={{ height: '100%' }}>
        <Box sx={{ display: 'flex', height: '100%' }}>
          <Box aria-hidden sx={(t) => ({ width: 4, flexShrink: 0, bgcolor: t.palette.leaveType[b.colorIndex % t.palette.leaveType.length] })} />
          <Box sx={{ p: 2, flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Box
                aria-hidden
                sx={(t) => ({ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: t.palette.leaveType[b.colorIndex % t.palette.leaveType.length] })}
              />
              <Typography variant="body2" fontWeight={600} noWrap>
                {b.name}
              </Typography>
            </Stack>
            {b.available === null ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                Approval only
              </Typography>
            ) : (
              <>
                <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ mt: 0.5 }}>
                  <Typography variant="kpi" component="p" sx={{ color: b.available < 0 ? '#B42318' : 'text.primary' }}>
                    {`${b.available < 0 ? '−' : ''}${Math.abs(b.available).toFixed(1)}`}
                  </Typography>
                  <Typography variant="body2" fontWeight={500} color="text.secondary">
                    d
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" component="p">
                  Available
                </Typography>
                {b.available < 0 && b.allowedNegative !== undefined && (
                  <Typography variant="caption" color="text.secondary" component="p">
                    Allowed down to −{b.allowedNegative.toFixed(1)}
                  </Typography>
                )}
                {b.earnedToDate !== undefined && (
                  <Typography variant="caption" color="text.secondary" component="p">
                    {b.earnedToDate.toFixed(1)} earned to date
                  </Typography>
                )}
              </>
            )}
            {b.expiring && (
              <Stack
                direction="row"
                spacing={0.75}
                sx={{ mt: 1, p: 1, borderRadius: 1, bgcolor: '#FFF1DB', color: '#7A4100' }}
              >
                <WarningAmberIcon aria-hidden sx={{ fontSize: 16, mt: '1px' }} />
                <Typography variant="caption" component="p">
                  {b.expiring.days.toFixed(1)} expires {formatDate(b.expiring.date)}
                </Typography>
              </Stack>
            )}
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  );
}

function QuickActions() {
  const btn = { minHeight: 48, justifyContent: 'flex-start' } as const;
  return (
    <Card>
      <CardContent>
        <CardTitle title="Quick actions" />
        <Grid container spacing={1.5}>
          <Grid size={6}>
            <Button fullWidth variant="contained" component={NextLink} href="/leave/apply" startIcon={<EventAvailableOutlinedIcon />} sx={btn}>
              Apply leave
            </Button>
          </Grid>
          <Grid size={6}>
            <Button fullWidth variant="contained" component={NextLink} href="/claims/new" startIcon={<ReceiptLongOutlinedIcon />} sx={btn}>
              New claim
            </Button>
          </Grid>
          <Grid size={6}>
            <Button
              fullWidth
              variant="outlined"
              color="inherit"
              component={NextLink}
              href="/leave/credits/new"
              startIcon={<SwapHorizOutlinedIcon />}
              sx={{ ...btn, lineHeight: 1.3 }}
            >
              Request replacement credit
            </Button>
          </Grid>
          <Grid size={6}>
            {/* R1.1: payslips. Shown disabled-with-reason until payroll ships. */}
            <Box component="span" title="Payslips arrive with Release 1.1" sx={{ display: 'block' }}>
              <Button fullWidth variant="outlined" color="inherit" disabled startIcon={<RequestQuoteOutlinedIcon />} sx={btn}>
                My payslips
              </Button>
            </Box>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}

function ManagerPanel({ m }: { m: NonNullable<HomeData['manager']> }) {
  const rows = [
    { label: 'Approvals waiting', value: m.approvals, href: '/approvals', accent: m.approvals > 0 ? '#5A5FF2' : '#8F95A3' },
    { label: 'Team on leave today', value: m.onLeaveToday, href: '/team/leave?when=today', accent: '#8F95A3' },
    { label: 'Team on leave this week', value: m.onLeaveWeek, href: '/team/leave?when=week', accent: '#8F95A3' },
    { label: 'Probation due in team', value: m.probationDue, href: '/team', accent: m.probationDue > 0 ? '#B45309' : '#8F95A3' },
    { label: 'Team claims submitted', value: m.teamClaimsSubmitted, href: '/team/claims?status=Submitted', accent: '#8F95A3' },
  ];
  return (
    <Card>
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
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box aria-hidden sx={{ width: 4, alignSelf: 'stretch', my: 1.5, borderRadius: 2, bgcolor: r.accent }} />
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {r.label}
                </Typography>
                <Typography className="pret-tnum" sx={{ fontSize: '1.25rem', lineHeight: 1.4, fontWeight: 700, color: r.value ? 'text.primary' : 'text.secondary' }}>
                  {r.value}
                </Typography>
                <ChevronRightIcon aria-hidden sx={{ fontSize: 18, color: '#4548C9' }} />
              </Box>
            </li>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

export default function EmployeeHome({ displayName, roleLabel, data, placeholder }: EmployeeHomeProps) {
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
    }
  };

  return (
    <Stack spacing={3}>
      {placeholder && (
        <Alert severity="info">
          Placeholder data for layout review only (W2-001). Real balances, claims and approvals arrive with the Leave, Claims and Portal work items.
        </Alert>
      )}

      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" component="h2">
          Hi, {displayName}
        </Typography>
        <Chip
          label={roleLabel}
          size="small"
          sx={{ height: 20, fontSize: '0.6875rem', bgcolor: '#5A5FF2', color: '#FFFFFF', '& .MuiChip-label': { px: 1 } }}
        />
      </Stack>

      <Grid container spacing={3}>
        {/* Left 8 */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={3}>
            <Box component="section" aria-label="Leave balances">
              <CardTitle title="Leave balances" href="/leave/balances" linkLabel="All" />
              {data.balances.length === 0 ? (
                <Card>
                  <EmptyState title="No leave types available yet — contact HR" minHeight={120} />
                </Card>
              ) : (
                <Box
                  sx={{
                    display: { xs: 'flex', sm: 'grid' },
                    gridTemplateColumns: { sm: 'repeat(auto-fill, minmax(200px, 1fr))' },
                    gap: 2,
                    overflowX: { xs: 'auto', sm: 'visible' },
                    scrollSnapType: { xs: 'x mandatory', sm: 'none' },
                    mx: { xs: -2, sm: 0 },
                    px: { xs: 2, sm: 0 },
                    pb: { xs: 0.5, sm: 0 },
                    '& > *': { flex: { xs: '0 0 168px', sm: 'initial' } },
                  }}
                >
                  {data.balances.map((b) => (
                    <BalanceCard key={b.id} b={b} />
                  ))}
                </Box>
              )}
            </Box>

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
                <KpiTile
                  label="Pending claims"
                  value={data.pendingClaims.count}
                  tone={data.pendingClaims.count > 0 ? 'warning' : 'grey'}
                  href="/claims?status=Submitted"
                  subLine={
                    <>
                      <MoneyText amount={data.pendingClaims.amount} /> awaiting approval
                    </>
                  }
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 7 }}>
                <Card sx={{ height: '100%' }}>
                  <CardContent>
                    <CardTitle title="My pending items" href="/leave/applications?status=pending" />
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
                            sx={{ minHeight: 56, borderTop: '1px solid', borderColor: 'divider' }}
                          >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Link component={NextLink} href={p.href} variant="body2" className="pret-tnum">
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

            <Card>
              <CardContent>
                <CardTitle title="Upcoming leave" href="/leave/applications" />
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
                        sx={{ minHeight: 48, borderTop: '1px solid', borderColor: 'divider' }}
                      >
                        <Box
                          aria-hidden
                          sx={(t) => ({ width: 10, height: 10, borderRadius: '50%', bgcolor: t.palette.leaveType[l.colorIndex % t.palette.leaveType.length] })}
                        />
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          {l.type} · <DateText value={l.from} /> – <DateText value={l.to} />
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

            <Card>
              <CardContent>
                <CardTitle title="Public holidays" href="/leave/holidays" />
                {data.holidays.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    The calendar has not been published yet.
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
                              borderRadius: 1,
                              bgcolor: '#EDEDFE',
                              color: '#3A3FBF',
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
                          <Chip label={h.state} size="small" variant="outlined" sx={{ color: '#374151', borderColor: '#8F95A3' }} />
                        </Stack>
                      );
                    })}
                  </Box>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <CardTitle title="Recent claims" href="/claims" />
                {data.recentClaims.length === 0 ? (
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
                        sx={{ minHeight: 56, borderTop: '1px solid', borderColor: 'divider' }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Link component={NextLink} href={c.href} variant="body2" className="pret-tnum">
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
