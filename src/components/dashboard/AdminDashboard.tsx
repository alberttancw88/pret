'use client';

// Admin dashboard (S-RP-01) — dashboard-visuals.md §4. Sections in UX order: HR, Claims,
// Payroll (R1.1). Tiles load independently; each is a link to its drill-in.
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
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
import StatusChip, { type StatusValue } from '../StatusChip';
import MoneyText from '../MoneyText';
import KpiTile, { DashboardSection, GRID_SX } from './KpiTile';
import { formatDateTime } from '@/lib/format';
import type { ToneName } from '@/theme/augment';

export type AdminDashboardData = {
  asAt: string;
  hr: {
    headcount: number;
    onLeaveToday: number;
    pendingLeave: number;
    pendingLeaveAdmin: number;
    probationDue: number;
    missingPayroll: number;
    changeRequests: number;
    phYear: number;
    phStatus: StatusValue<'phCalendar'>;
  };
  alerts: { message: string; href: string }[];
  claims: {
    submitted: number;
    approvedNotDisbursed: number;
    disbursed: number;
    rejected: number;
    exclSst: number;
    sst: number;
    total: number;
    awaiting: { count: number; amount: number };
    approvedNd: { count: number; amount: number; aged: number };
    batch: { ref: string; href: string; status: StatusValue<'batch'>; outOfDate: boolean } | null;
  };
};

const NEXT_STEP: Record<string, string> = {
  Draft: 'Generate outputs',
  'Pending approval': 'Awaiting Super Admin',
  Approved: 'Generate outputs',
  Exported: 'Mark disbursed',
  Disbursed: 'Done',
  Cancelled: '—',
};

const BATCH_TONE: Record<string, ToneName> = {
  Draft: 'grey',
  'Pending approval': 'warning',
  Approved: 'info',
  Exported: 'pink',
  Disbursed: 'success',
  Cancelled: 'grey',
};

const amberIf = (n: number): ToneName => (n > 0 ? 'warning' : 'grey');

export default function AdminDashboard({ data, placeholder }: { data: AdminDashboardData; placeholder?: boolean }) {
  const router = useRouter();
  const [period, setPeriod] = React.useState<'this' | 'last' | 'year'>('this');
  const { hr, claims } = data;

  return (
    <Stack spacing={3}>
      {placeholder && (
        <Alert severity="info">
          Placeholder data for layout review only (W2-001). Live figures arrive with the Reports work item (W2-007).
        </Alert>
      )}

      <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={0.5}>
        <Typography variant="caption" color="text.secondary">
          as at <span className="pret-tnum">{formatDateTime(data.asAt)}</span>
        </Typography>
        <Tooltip title="Refresh dashboard">
          <IconButton aria-label="Refresh dashboard" onClick={() => router.refresh()} sx={{ width: 44, height: 44 }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <DashboardSection title="HR">
        <Box sx={GRID_SX}>
          <KpiTile label="Active headcount" value={hr.headcount} tone="violet" href="/employees" />
          <KpiTile label="On leave today" value={hr.onLeaveToday} tone="info" href="/leave/applications?when=today" />
          <KpiTile
            label="Pending leave approvals"
            value={hr.pendingLeave}
            secondary={`(${hr.pendingLeaveAdmin} at Admin level)`}
            tone={amberIf(hr.pendingLeave)}
            href="/approvals?tab=leave"
          />
          <KpiTile label="Probation ending ≤ 30 days" value={hr.probationDue} tone={amberIf(hr.probationDue)} href="/employees?probationEndingWithin=30" />
          <KpiTile label="Missing payroll data" value={hr.missingPayroll} tone={amberIf(hr.missingPayroll)} href="/admin/reports/missing-payroll-data" />
          <KpiTile label="Change requests" value={hr.changeRequests} tone={amberIf(hr.changeRequests)} href="/employees/change-requests" />
          <KpiTile
            label={`PH calendar ${hr.phYear}`}
            tone={hr.phStatus === 'Published' ? 'success' : 'warning'}
            href="/organisation/holidays"
            subLine={`Publish by 31/12/${hr.phYear - 1}`}
          >
            <Box sx={{ mt: 1 }}>
              <StatusChip set="phCalendar" value={hr.phStatus} />
            </Box>
          </KpiTile>
        </Box>

        {data.alerts.length > 0 && (
          <Card sx={{ mt: 2, bgcolor: 'tone.warning.bg', borderColor: 'warning.main' }}>
            <Box component="ul" aria-label="Alerts" sx={{ listStyle: 'none', m: 0, p: 1 }}>
              {data.alerts.slice(0, 4).map((a) => (
                <li key={a.message}>
                  <Box
                    component={NextLink}
                    href={a.href}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      minHeight: 44,
                      px: 1,
                      color: 'warning.dark',
                      textDecoration: 'none',
                      borderRadius: 1,
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    <WarningAmberIcon aria-hidden sx={{ color: 'warning.main', fontSize: 20 }} />
                    <Typography variant="body2" sx={{ flex: 1 }}>
                      {a.message}
                    </Typography>
                    <ChevronRightIcon aria-hidden fontSize="small" />
                  </Box>
                </li>
              ))}
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
            onChange={(_e, v) => v && setPeriod(v)}
            aria-label="Claims period"
          >
            <ToggleButton value="this">This month</ToggleButton>
            <ToggleButton value="last">Last month</ToggleButton>
            <ToggleButton value="year">Year</ToggleButton>
          </ToggleButtonGroup>
        }
      >
        <Box sx={GRID_SX}>
          <KpiTile label="Submitted" value={claims.submitted} tone={amberIf(claims.submitted)} href="/claims?statuses=submitted" />
          <KpiTile label="Approved (not disbursed)" value={claims.approvedNotDisbursed} tone="info" href="/claims?statuses=approved" />
          <KpiTile label="Disbursed" value={claims.disbursed} tone="success" href="/claims?statuses=disbursed" />
          <KpiTile label="Rejected" value={claims.rejected} tone="grey" href="/claims?statuses=rejected" />
        </Box>

        <Card sx={{ mt: 2 }}>
          <CardContent>
            <Box
              component="dl"
              sx={{ m: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' } }}
            >
              {[
                ['Excl. SST', claims.exclSst],
                ['SST', claims.sst],
                ['Total', claims.total],
              ].map(([label, amount]) => (
                <Box key={label as string} sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                  <Typography component="dt" variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography component="dd" sx={{ m: 0, fontSize: '1.25rem', lineHeight: 1.4, fontWeight: 700 }}>
                    <MoneyText amount={amount as number} />
                  </Typography>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>

        <Box sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(260px, 1fr))' } }}>
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
            href="/admin/reports/approved-not-disbursed"
            subLine={
              claims.approvedNd.aged > 0 ? (
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <ScheduleIcon aria-hidden sx={{ fontSize: 14 }} />
                  <span>{claims.approvedNd.aged} older than 30 days</span>
                </Stack>
              ) : undefined
            }
          />
          {claims.batch ? (
            <KpiTile label="Current month-end batch" tone={BATCH_TONE[claims.batch.status] ?? 'grey'}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                <Link component={NextLink} href={claims.batch.href} className="pret-tnum">
                  {claims.batch.ref}
                </Link>
                <StatusChip set="batch" value={claims.batch.status} />
                {claims.batch.outOfDate && <StatusChip set="batch" value="Outputs out of date" />}
              </Stack>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                Next: {(NEXT_STEP[claims.batch.status] ?? '—').toLowerCase()}
              </Typography>
            </KpiTile>
          ) : (
            <KpiTile label="Current month-end batch" tone="grey" href="/claims/batches" subLine="No open batch" />
          )}
        </Box>
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
