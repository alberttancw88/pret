'use client';

// Admin dashboard (S-RP-01) — dashboard-visuals.md §4. Sections in UX order: HR, Claims,
// Payroll (R1.1). Tiles load independently; each is a link to its drill-in.
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ScheduleIcon from '@mui/icons-material/Schedule';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import StatusChip from '../StatusChip';
import MoneyText from '../MoneyText';
import KpiTile, { DashboardSection, GRID3_SX, GRID_SX } from './KpiTile';
import { formatDate, formatDateTime } from '@/lib/format';
import ErrorState from '../ErrorState';
import type { ToneName } from '@/theme/augment';
import type { AdminDashboard, DashboardAlert, DashboardClaimPeriod } from '@/server/contracts/reports';
import { fetchAdminDashboard } from '@/server/actions/reports';
import { useToast } from '../ToastProvider';
import { isStatusValue } from '../StatusChip';

/** R1 data — the contract type from getAdminDashboard / fetchAdminDashboard (W2-007, live). */
export type AdminDashboardData = AdminDashboard;

const BATCH_TONE: Record<string, ToneName> = {
  Draft: 'grey',
  'Pending approval': 'warning',
  Approved: 'info',
  Exported: 'pink',
  Disbursed: 'success',
  Cancelled: 'grey',
};

const ALERT_COLOUR: Record<DashboardAlert['tone'], { bg: string; fg: string; icon: string }> = {
  warning: { bg: 'tone.warning.bg', fg: 'warning.dark', icon: 'warning.main' },
  error: { bg: 'tone.error.bg', fg: 'error.dark', icon: 'error.main' },
  info: { bg: 'tone.info.bg', fg: 'info.dark', icon: 'info.main' },
};

const amberIf = (n: number | null): ToneName => ((n ?? 0) > 0 ? 'warning' : 'grey');

export default function AdminDashboard({ data: initial, preview }: { data: AdminDashboardData; preview?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = React.useState(initial);
  const [period, setPeriod] = React.useState<DashboardClaimPeriod>(initial.claims?.period ?? 'this');
  const [loadingClaims, setLoadingClaims] = React.useState(false);
  React.useEffect(() => {
    setData(initial);
    setPeriod(initial.claims?.period ?? 'this');
  }, [initial]);

  /** RETRY on a failed tile / the claims period toggle: reload through the Server Action (tiles stay independent). */
  const reload = async (claimPeriod: DashboardClaimPeriod = period) => {
    if (preview) return;
    setLoadingClaims(true);
    try {
      const res = await fetchAdminDashboard({ claimPeriod });
      if (res.ok) setData(res.dashboard);
      else toast.info(res.error);
    } finally {
      setLoadingClaims(false);
    }
  };
  const retry = { onRetry: () => void reload() };
  const { hr, claims } = data;
  const tile = (n: number | null) => (n === null ? { error: retry } : { value: n });

  return (
    <Stack spacing={3}>
      <DashboardSection
        title="HR"
        action={
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Typography variant="body2" color="text.secondary">
              as at <span className="pret-tnum">{formatDateTime(data.asAt)}</span>
            </Typography>
            <Tooltip title="Refresh dashboard">
              <IconButton aria-label="Refresh dashboard" onClick={() => router.refresh()} sx={{ width: 40, height: 40, color: 'text.secondary' }}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        }
      >
        <Box sx={GRID_SX}>
          <KpiTile label="Active headcount" {...tile(hr.headcount)} tone="violet" href="/employees" />
          <KpiTile label="On leave today" {...tile(hr.onLeaveToday)} tone="info" href="/reports/whos-on-leave" />
          <KpiTile
            label="Pending leave approvals"
            {...tile(hr.pendingLeave)}
            secondary={hr.pendingLeaveAdmin !== null ? `(${hr.pendingLeaveAdmin} at Admin level)` : undefined}
            tone={amberIf(hr.pendingLeave)}
            href="/approvals?tab=leave"
          />
          <KpiTile label="Probation ending ≤ 30 days" {...tile(hr.probationDue)} tone={amberIf(hr.probationDue)} href="/reports/probation-due" />
          <KpiTile label="Missing payroll data" {...tile(hr.missingPayroll)} tone={amberIf(hr.missingPayroll)} href="/reports/data-completeness?incompleteOnly=true" />
          <KpiTile label="Change requests" {...tile(hr.changeRequests)} tone={amberIf(hr.changeRequests)} href="/employees/change-requests" />
          <KpiTile
            label={`PH calendar ${hr.phYear}`}
            tone={hr.phStatus === 'Published' ? 'success' : 'warning'}
            href="/organisation/holidays"
            subLine={hr.phStatus === 'Published' ? 'Published' : `Publish by ${formatDate(hr.phPublishBy)}`}
          >
            <Box sx={{ mt: 1 }}>
              {isStatusValue('phCalendar', hr.phStatus) && <StatusChip set="phCalendar" value={hr.phStatus} />}
            </Box>
          </KpiTile>
        </Box>

        {data.alerts.length > 0 && (
          <Card sx={{ mt: 2 }}>
            <Box component="ul" aria-label="Alerts" sx={{ listStyle: 'none', m: 0, p: 1 }}>
              {data.alerts.slice(0, 4).map((a) => {
                const c = ALERT_COLOUR[a.tone] ?? ALERT_COLOUR.warning;
                return (
                  <li key={`${a.code}-${a.message}`}>
                    <Box
                      component={NextLink}
                      href={a.href}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                        minHeight: 44,
                        px: 1,
                        my: 0.5,
                        bgcolor: c.bg,
                        color: c.fg,
                        textDecoration: 'none',
                        borderRadius: 1,
                        '&:hover': { textDecoration: 'underline' },
                      }}
                    >
                      {a.tone === 'info' ? (
                        <InfoOutlinedIcon aria-hidden sx={{ color: c.icon, fontSize: 20 }} />
                      ) : (
                        <WarningAmberIcon aria-hidden sx={{ color: c.icon, fontSize: 20 }} />
                      )}
                      <Typography variant="body2" sx={{ flex: 1 }}>
                        {a.message}
                      </Typography>
                      <ChevronRightIcon aria-hidden fontSize="small" />
                    </Box>
                  </li>
                );
              })}
            </Box>
          </Card>
        )}
      </DashboardSection>

      <DashboardSection
        title="Claims"
        action={
          <ToggleButtonGroup
            size="small"
            exclusive
            value={period}
            disabled={loadingClaims}
            onChange={(_e, v: DashboardClaimPeriod | null) => {
              if (!v) return;
              setPeriod(v);
              void reload(v);
            }}
            aria-label="Claims period"
          >
            <ToggleButton value="this">This month</ToggleButton>
            <ToggleButton value="last">Last month</ToggleButton>
            <ToggleButton value="year">Year</ToggleButton>
          </ToggleButtonGroup>
        }
      >
        {claims === null ? (
          <Card>
            <CardContent>
              <ErrorState kind="card" message="Couldn't load the claims figures." onRetry={retry.onRetry} />
            </CardContent>
          </Card>
        ) : (
          <>
            <Typography variant="caption" color="text.secondary" component="p" className="pret-tnum" sx={{ mt: -1, mb: 1 }}>
              {formatDate(claims.periodFrom)} – {formatDate(claims.periodTo)}
            </Typography>
            <Box sx={GRID_SX}>
              <KpiTile loading={loadingClaims} label="Submitted" value={claims.submitted} tone={amberIf(claims.submitted)} href={`/claims?statuses=submitted&submittedFrom=${claims.periodFrom}&submittedTo=${claims.periodTo}`} />
              <KpiTile loading={loadingClaims} label="Approved (not disbursed)" value={claims.approvedNotDisbursed} tone="info" href={`/claims?statuses=approved&submittedFrom=${claims.periodFrom}&submittedTo=${claims.periodTo}`} />
              <KpiTile loading={loadingClaims} label="Disbursed" value={claims.disbursed} tone="success" href={`/claims?statuses=disbursed&submittedFrom=${claims.periodFrom}&submittedTo=${claims.periodTo}`} />
              <KpiTile loading={loadingClaims} label="Rejected" value={claims.rejected} tone="grey" href={`/claims?statuses=rejected&submittedFrom=${claims.periodFrom}&submittedTo=${claims.periodTo}`} />
            </Box>

            <Card sx={{ mt: 2 }}>
              <CardContent>
                {/* Review fix: three equal, left-aligned columns; label above, one value size (22 px). */}
                <Box component="dl" sx={{ m: 0, ...GRID3_SX }}>
                  {(
                    [
                      ['Excl. SST', claims.exclSst],
                      ['SST', claims.sst],
                      ['Total', claims.total],
                    ] as const
                  ).map(([label, amount]) => (
                    <Box key={label}>
                      <Typography component="dt" color="text.secondary" sx={{ fontSize: '0.84375rem', lineHeight: '19px', fontWeight: 600 }}>
                        {label}
                      </Typography>
                      <Typography component="dd" className="pret-tnum" sx={{ m: 0, mt: 0.5, fontSize: '1.375rem', lineHeight: '30px', fontWeight: 700, letterSpacing: '-0.01em' }}>
                        <MoneyText amount={amount} />
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>

            <Box sx={{ mt: 2, ...GRID3_SX }}>
              <KpiTile
                label="Awaiting approval"
                value={claims.awaiting.count}
                secondary={<MoneyText amount={claims.awaiting.amount} />}
                tone={amberIf(claims.awaiting.count)}
                href="/approvals?tab=claims"
              />
              <KpiTile
                label="Approved not disbursed"
                value={claims.approvedNd.count}
                secondary={<MoneyText amount={claims.approvedNd.amount} />}
                tone="info"
                href="/reports/approved-not-disbursed"
                subLine={
                  claims.approvedNd.agedOver30 > 0 ? (
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      <ScheduleIcon aria-hidden sx={{ fontSize: 14 }} />
                      <span>{claims.approvedNd.agedOver30} older than 30 days</span>
                    </Stack>
                  ) : undefined
                }
              />
              {claims.batch ? (
                <KpiTile label="Current month-end batch" tone={BATCH_TONE[claims.batch.statusLabel] ?? 'grey'}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                    <Link component={NextLink} href={claims.batch.href} className="pret-tnum">
                      {claims.batch.batchNo}
                    </Link>
                    {isStatusValue('batch', claims.batch.statusLabel) && <StatusChip set="batch" value={claims.batch.statusLabel} />}
                    {claims.batch.outOfDate && <StatusChip set="batch" value="Outputs out of date" />}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                    Next: {claims.batch.nextStep}
                  </Typography>
                </KpiTile>
              ) : (
                <KpiTile label="Current month-end batch" tone="grey" href="/claims/batches" subLine="No open batch" />
              )}
            </Box>
          </>
        )}
      </DashboardSection>

      <DashboardSection title="Payroll (R1.1)">
        <Card>
          <CardContent>
            <Typography variant="body2" color="text.secondary">
              Payroll runs, statutory due dates and the gross / net chart arrive with Release 1.1.
            </Typography>
          </CardContent>
        </Card>
      </DashboardSection>
    </Stack>
  );
}
