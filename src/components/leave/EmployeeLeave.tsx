'use client';

// E3 profile tab 10 · Leave (wireframes-employees E3): balances (S-PT-05 cards for this employee, year selector) ·
// applications (S-PT-03 columns + Decided by) · replacement credits · overrides for this employee · APPLY ON BEHALF (L2) ·
// ADJUST BALANCE (L5, not own) · ADD OVERRIDE (L6) · VIEW LEDGER (P6) · YEARLY REPORT (P7 → W2-007) · Leaver card (if
// separated / LWD set): leave position at LWD — encashable / recoverable days (F-LV-27).
// P32 team-member leave section (MGR): balances + team-scope applications; no ledger (F-LV-28).
import * as React from 'react';
import NextLink from 'next/link';
import { useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { CreditRow, EmployeeLeaveTab, LeaverPosition, MyLeaveRow, OverrideRow, TeamMemberLeave } from '@/server/contracts/leave';
import { CREDIT_DURATION_LABELS } from '@/server/contracts/leave';
import { MiniTable } from '../employees/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import { BalanceCards, YearSelect } from './Balances';
import { CreditStatusChip, DaysCell, EmergencyChip, LeaveStatusChip, TypeLabel, formatDays } from './common';
import { AdjustBalanceDialog, OverrideDialog, type SetupType } from './AdjustOverride';

const card = { p: { xs: 2, sm: 3 } } as const;

function ApplicationsTable({ rows, hrefFor }: { rows: MyLeaveRow[]; hrefFor: (r: MyLeaveRow) => string }) {
  return (
    <MiniTable
      caption="Leave applications"
      rows={rows}
      getRowId={(r) => r.id}
      empty="No leave applications this year."
      columns={[
        {
          key: 'ref',
          header: 'Reference',
          render: (r) => (
            <Link component={NextLink} href={hrefFor(r)} className="pret-tnum">
              {r.refNo}
            </Link>
          ),
        },
        { key: 't', header: 'Type', render: (r) => <TypeLabel type={r.leaveType} /> },
        { key: 'f', header: 'From', render: (r) => formatDate(r.startDate) },
        { key: 'to', header: 'To', render: (r) => formatDate(r.endDate) },
        { key: 'd', header: 'Days', align: 'right', render: (r) => formatDays(r.days) },
        {
          key: 's',
          header: 'Status',
          render: (r) => (
            <Stack direction="row" spacing={0.5}>
              <LeaveStatusChip status={r.status} level={r.level} />
              {r.isEmergency && <EmergencyChip />}
            </Stack>
          ),
        },
        { key: 'sub', header: 'Submitted', render: (r) => formatDateTime(r.submittedAt) },
        { key: 'dec', header: 'Decided by / at', render: (r) => (r.decidedAt ? `${r.decidedByName ?? ''} · ${formatDateTime(r.decidedAt)}` : '—') },
      ]}
    />
  );
}

export function LeaverCard({ position }: { position: LeaverPosition }) {
  return (
    <Card>
      <CardContent sx={card}>
        <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
          Leave position at last working day ({formatDate(position.lastWorkingDay)})
        </Typography>
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          {position.summary}
        </Alert>
        <MiniTable
          caption="Leave position at LWD"
          rows={position.rows}
          getRowId={(r) => r.leaveType.id}
          columns={[
            { key: 't', header: 'Type', render: (r) => r.leaveType.name },
            { key: 'e', header: 'Entitlement to LWD', align: 'right', render: (r) => formatDays(r.entitledToLwd) },
            { key: 'tk', header: 'Taken', align: 'right', render: (r) => formatDays(r.taken) },
            { key: 'b', header: 'Balance', align: 'right', render: (r) => <DaysCell value={r.balance} /> },
            { key: 'en', header: 'Encashable', align: 'right', render: (r) => formatDays(r.encashable) },
            { key: 'rc', header: 'Recoverable', align: 'right', render: (r) => formatDays(r.recoverable) },
          ]}
        />
        {position.leaveAfterLwd.length > 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Approved leave after the last working day will be flagged for cancellation:{' '}
            {position.leaveAfterLwd.map((l) => `${l.refNo} (${formatDate(l.startDate)} – ${formatDate(l.endDate)}, ${formatDays(l.days)} d)`).join('; ')}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

export function EmployeeLeaveTabView({
  tab,
  types,
  currentYear,
  isSuperAdmin,
  isOwnRecord,
}: {
  tab: EmployeeLeaveTab | null;
  types: SetupType[];
  currentYear: number;
  isSuperAdmin: boolean;
  isOwnRecord: boolean;
}) {
  const sp = useSearchParams();
  const [dlg, setDlg] = React.useState<'adjust' | 'override' | null>(() => {
    const a = sp?.get('action');
    return a === 'adjust' || a === 'override' ? a : null;
  });
  if (!tab) return <Alert severity="info">Leave data is not available for this employee.</Alert>;
  const emp = { id: tab.employee.id, employeeNo: tab.employee.employeeNo, name: tab.employee.name };
  const ledger = (typeId: string) => `/leave/ledger?employee=${encodeURIComponent(tab.employee.id)}&type=${encodeURIComponent(typeId)}&year=${tab.year}`;
  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} flexWrap="wrap" useFlexGap>
            <YearSelect year={tab.year} years={tab.years} />
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ ml: { sm: 'auto' } }}>
              {tab.can.applyOnBehalf && (
                <Button variant="contained" component={NextLink} href={`/leave/apply-on-behalf?employee=${encodeURIComponent(tab.employee.id)}`}>
                  Apply on behalf
                </Button>
              )}
              {tab.can.adjust && !isOwnRecord && (
                <Button variant="outlined" onClick={() => setDlg('adjust')}>
                  Adjust balance
                </Button>
              )}
              {tab.can.addOverride && !isOwnRecord && (
                <Button variant="outlined" onClick={() => setDlg('override')}>
                  Add override
                </Button>
              )}
              <Button variant="text" disabled title="Yearly leave report (P7) arrives with W2-007">
                Yearly report
              </Button>
            </Stack>
          </Stack>
          {isOwnRecord && (
            <Typography variant="body2" sx={{ mt: 1, color: '#B45309' }}>
              This is your own record — adjustments, overrides and applying on behalf are done by another Admin or Super Admin.
            </Typography>
          )}
        </CardContent>
      </Card>

      {tab.leaver && <LeaverCard position={tab.leaver} />}

      <BalanceCards cards={tab.balances} empty={`No leave entitlements for ${tab.year} yet.`} ledgerHref={tab.can.viewLedger ? (c) => ledger(c.leaveType.id) : undefined} />

      <Card>
        <CardContent sx={card}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Applications ({tab.year})
          </Typography>
          <ApplicationsTable rows={tab.applications} hrefFor={(r) => `/approvals/leave/${encodeURIComponent(r.refNo)}?from=applications`} />
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={card}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Replacement credits
          </Typography>
          <MiniTable
            caption="Replacement credits"
            rows={tab.credits}
            getRowId={(r: CreditRow) => r.id}
            empty="No replacement credits."
            columns={[
              {
                key: 'n',
                header: 'Credit no.',
                render: (r) => (
                  <Link component={NextLink} href={`/approvals/credits/${encodeURIComponent(r.creditNo)}?from=credits`}>
                    {r.creditNo}
                  </Link>
                ),
              },
              { key: 'dw', header: 'Date worked', render: (r) => `${formatDate(r.dateWorked)} · ${r.dayTypeLabel}` },
              { key: 'du', header: 'Duration', render: (r) => CREDIT_DURATION_LABELS[r.duration] },
              { key: 's', header: 'Status', render: (r) => <CreditStatusChip status={r.status} /> },
              { key: 'e', header: 'Expiry', render: (r) => formatDate(r.expiryDate) || '—' },
              { key: 'u', header: 'Used / remaining', align: 'right', render: (r) => `${formatDays(r.used)} / ${formatDays(r.remaining)}` },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={card}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Entitlement overrides
          </Typography>
          <MiniTable
            caption="Entitlement overrides"
            rows={tab.overrides}
            getRowId={(r: OverrideRow) => r.id}
            empty="No overrides for this employee."
            columns={[
              { key: 't', header: 'Type', render: (r) => r.leaveType.name },
              { key: 'y', header: 'Year', render: (r) => r.year },
              { key: 'd', header: 'Days (override)', align: 'right', render: (r) => formatDays(r.days) },
              { key: 'b', header: 'Band value', align: 'right', render: (r) => formatDays(r.bandValue) || '—' },
              { key: 'r', header: 'Reason', render: (r) => r.reason },
              { key: 'by', header: 'Entered by / at', render: (r) => `${r.enteredByName} · ${formatDateTime(r.enteredAt)}` },
            ]}
          />
        </CardContent>
      </Card>

      <AdjustBalanceDialog open={dlg === 'adjust'} onClose={() => setDlg(null)} types={types} currentYear={currentYear} employee={emp} />
      <OverrideDialog open={dlg === 'override'} onClose={() => setDlg(null)} types={types} currentYear={currentYear} isSuperAdmin={isSuperAdmin} employee={emp} />
    </Stack>
  );
}

/** P32 leave section (team scope; balances without ledger links). */
export function TeamMemberLeaveView({ leave }: { leave: TeamMemberLeave | null }) {
  if (!leave) return <Alert severity="info">Leave data is not available for this team member.</Alert>;
  return (
    <Stack spacing={2}>
      <BalanceCards cards={leave.balances} empty={`No leave entitlements for ${leave.year} yet.`} />
      <Card>
        <CardContent sx={card}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Applications ({leave.year})
          </Typography>
          <ApplicationsTable rows={leave.applications} hrefFor={(r) => `/approvals/leave/${encodeURIComponent(r.refNo)}?from=team`} />
        </CardContent>
      </Card>
    </Stack>
  );
}
