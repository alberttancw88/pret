'use client';

// Dev-only visual review of the W2-001 component set (/dev/components). Synthetic data only.
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import StatusChip, { STATUS_MAP, STATUS_SETS, type StatusSet, type StatusValue } from '../StatusChip';
import MoneyText from '../MoneyText';
import DateText from '../DateText';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import { CardListSkeleton, DetailHeaderSkeleton, TableSkeleton, TileSkeleton } from '../Skeletons';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ReasonDialog from '../dialogs/ReasonDialog';
import { useToast } from '../ToastProvider';
import ListPage, { type ListColumn, type SortState } from '../list/ListPage';
import { DateFilter, KeywordField, SelectFilter } from '../list/FilterFields';
import { csvFileName, downloadCsv, toCsv } from '../list/csv';
import KpiTile, { GRID_SX, PASTEL_ORDER } from '../dashboard/KpiTile';
import AdminDashboard from '../dashboard/AdminDashboard';
import EmployeeHome, { type HomeData } from '../dashboard/EmployeeHome';
import ReportViewer from '../reports/ReportViewer';
import PayrollInputPack from '../reports/PayrollInputPack';
import { SAMPLE_ADMIN_DASHBOARD, SAMPLE_PAYROLL_PACK, SAMPLE_REPORT_OPTIONS, SAMPLE_REPORT_RESULT } from './sampleData';
import { formatAmount, formatDate } from '@/lib/format';

// ---------------------------------------------------------------- synthetic rows
type ClaimRow = {
  ref: string;
  employee: string;
  title: string;
  submitted: string;
  amount: number;
  status: StatusValue<'claim'>;
  flag?: StatusValue<'claim'>;
};

const STATUSES: StatusValue<'claim'>[] = ['New', 'Submitted', 'Approved', 'Disbursed', 'Rejected', 'Withdrawn', 'Cancelled'];
const ROWS: ClaimRow[] = Array.from({ length: 57 }, (_, i) => {
  const n = i + 1;
  const day = ((n * 7) % 28) + 1;
  const month = (n % 11) + 1;
  return {
    ref: `CL-2026-${String(n).padStart(5, '0')}`,
    employee: `INT-${String(100 + (n % 13)).padStart(3, '0')} · Sample Employee ${String.fromCharCode(65 + (n % 13))}`,
    title: ['Client visit', 'Mileage', 'Training materials', 'Parking', 'Team lunch'][n % 5],
    submitted: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    amount: Math.round(((n * 37.13) % 1250) * 100) / 100 + 10,
    status: STATUSES[n % STATUSES.length],
    flag: n % 9 === 0 ? 'Over limit' : n % 14 === 0 ? 'Possible duplicate' : undefined,
  };
});

const COLUMNS: ListColumn<ClaimRow>[] = [
  { key: 'ref', header: 'Claim no.', value: (r) => r.ref },
  { key: 'employee', header: 'Employee', value: (r) => r.employee, minWidth: 220 },
  { key: 'title', header: 'Title', value: (r) => r.title, priority: 'low' },
  { key: 'submitted', header: 'Submitted', kind: 'date', value: (r) => formatDate(r.submitted), render: (r) => <DateText value={r.submitted} /> },
  { key: 'amount', header: 'Total (RM)', kind: 'money', value: (r) => formatAmount(r.amount, { plain: true }).replace(/,/g, ''), render: (r) => <MoneyText amount={r.amount} mode="table" /> },
  {
    key: 'status',
    header: 'Status',
    kind: 'status',
    sortable: false,
    value: (r) => r.status,
    render: (r) => (
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
        <StatusChip set="claim" value={r.status} />
        {r.flag && <StatusChip set="claim" value={r.flag} />}
      </Stack>
    ),
  },
];

function DemoList() {
  const toast = useToast();
  const [draft, setDraft] = React.useState({ q: '', status: '', from: '', to: '' });
  const [applied, setApplied] = React.useState(draft);
  const [page, setPage] = React.useState(0);
  const [rpp, setRpp] = React.useState(10);
  const [sort, setSort] = React.useState<SortState>({ key: 'submitted', direction: 'desc' });
  const [selected, setSelected] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState<'initial' | 'refresh' | false>('initial');
  const [showEmpty, setShowEmpty] = React.useState(false);

  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600);
    return () => clearTimeout(t);
  }, []);

  const requery = (fn: () => void) => {
    setLoading('refresh');
    setTimeout(() => {
      fn();
      setLoading(false);
    }, 350);
  };

  const filtered = React.useMemo(() => {
    if (showEmpty) return [];
    const q = applied.q.trim().toLowerCase();
    const rows = ROWS.filter(
      (r) =>
        (!q || r.ref.toLowerCase().includes(q) || r.employee.toLowerCase().includes(q) || r.title.toLowerCase().includes(q)) &&
        (!applied.status || r.status === applied.status) &&
        (!applied.from || r.submitted >= applied.from) &&
        (!applied.to || r.submitted <= applied.to),
    );
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key as keyof ClaimRow] ?? '';
      const bv = b[sort.key as keyof ClaimRow] ?? '';
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [applied, sort, showEmpty]);

  const activeFilterCount = Object.values(applied).filter(Boolean).length;

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
        <Button size="small" variant="outlined" color="inherit" onClick={() => setShowEmpty((s) => !s)}>
          {showEmpty ? 'Show rows' : 'Show "nothing yet" state'}
        </Button>
      </Stack>
      <ListPage<ClaimRow>
        itemName={{ singular: 'claim', plural: 'claims' }}
        filters={[
          <KeywordField key="q" value={draft.q} onChange={(v) => setDraft((d) => ({ ...d, q: v }))} hint="Claim no., employee, title" />,
          <SelectFilter
            key="status"
            label="Status"
            value={draft.status}
            onChange={(v) => setDraft((d) => ({ ...d, status: v }))}
            options={STATUSES.map((s) => ({ value: s, label: s }))}
          />,
          <DateFilter key="from" label="Submitted from" value={draft.from} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />,
          <DateFilter key="to" label="Submitted to" value={draft.to} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />,
        ]}
        activeFilterCount={activeFilterCount}
        onSearch={() => requery(() => { setApplied(draft); setPage(0); })}
        onClear={() => {
          const empty = { q: '', status: '', from: '', to: '' };
          setDraft(empty);
          requery(() => { setApplied(empty); setPage(0); });
        }}
        onExport={async () => {
          await new Promise((r) => setTimeout(r, 400));
          downloadCsv(csvFileName('claims'), toCsv(COLUMNS.map((c) => ({ header: c.header, value: (r: ClaimRow) => c.value?.(r) })), filtered));
          toast.success(`Exported ${filtered.length} claims.`);
        }}
        addNew={{ label: 'Add new claim', onClick: () => toast.info('Would open New claim.') }}
        columns={COLUMNS}
        rows={filtered.slice(page * rpp, page * rpp + rpp)}
        getRowId={(r) => r.ref}
        getRowHref={(r) => `/dev/components?claim=${r.ref}`}
        rowActions={(r) =>
          r.status === 'Submitted'
            ? [
                { label: 'Approve', onClick: () => toast.success(`${r.ref} approved.`) },
                { label: 'Reject', onClick: () => toast.info('Would open the reason dialog.'), danger: true },
              ]
            : []
        }
        total={filtered.length}
        page={page}
        rowsPerPage={rpp}
        onPageChange={(p) => requery(() => setPage(p))}
        onRowsPerPageChange={(n) => requery(() => { setRpp(n); setPage(0); })}
        sort={sort}
        onSortChange={(s) => requery(() => setSort(s))}
        loading={loading}
        empty={{ action: <Button variant="contained" startIcon={<AddIcon />}>New claim</Button> }}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={
          <>
            <Button size="small" variant="contained" color="success" onClick={() => toast.success(`${selected.length} approved.`)}>
              Approve selected
            </Button>
            <Button size="small" variant="outlined" color="error">
              Decline selected
            </Button>
          </>
        }
      />
    </>
  );
}

// ---------------------------------------------------------------- page
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card component="section">
      <CardContent>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          {title}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

const SET_TITLES: Record<StatusSet, string> = {
  claim: 'Claims (D12) + flags',
  leave: 'Leave applications + flags',
  credit: 'Replacement credits',
  changeRequest: 'Change requests',
  employment: 'Employment status',
  batch: 'Disbursement batches',
  payrollRun: 'Payroll runs (R1.1)',
  import: 'Import jobs',
  user: 'Users',
  phCalendar: 'PH calendar year',
  active: 'Master data active flag',
  accessReview: 'Access review month',
  payslip: 'Payslip (R1.1)',
  eaForm: 'EA form (R1.1)',
  statutoryTable: 'Statutory table (R1.1)',
  dsr: 'Data-subject requests',
  role: 'Role chip (shell)',
};

export default function ComponentGallery() {
  const toast = useToast();
  const [confirm, setConfirm] = React.useState<null | 'destructive' | 'positive'>(null);
  const [reason, setReason] = React.useState(false);

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, sm: 3 }, py: 4 }}>
      <Typography variant="h3" component="h1">
        PRET components (dev only)
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        W2-001 visual review, Sunrise theme (W2-009). Synthetic data only. This route returns 404 in production.
      </Typography>

      <Stack spacing={3}>
        <Section title="Status chips (components.md §3)">
          <Stack spacing={2.5} divider={<Divider />}>
            {STATUS_SETS.map((set) => (
              <Box key={set}>
                <Typography variant="overline" component="h3" color="text.secondary">
                  {SET_TITLES[set]} · set=&quot;{set}&quot;
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                  {(Object.keys(STATUS_MAP[set]) as StatusValue<typeof set>[]).map((v) => (
                    <StatusChip
                      key={v}
                      set={set}
                      value={v}
                      label={set === 'leave' && v === 'Delegated from' ? 'Delegated from Sample Manager' : undefined}
                    />
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        </Section>

        <Section title="Buttons (components.md §1)">
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button variant="contained">Search</Button>
            <Button variant="contained" startIcon={<AddIcon />}>
              Add new employee
            </Button>
            <Button variant="contained" color="success" startIcon={<FileDownloadOutlinedIcon />}>
              Export .CSV
            </Button>
            <Button variant="contained" color="success">
              Approve
            </Button>
            <Button variant="outlined" color="error">
              Reject
            </Button>
            <Button variant="contained" color="error">
              Reject claim
            </Button>
            <Button variant="outlined" color="inherit">
              Clear
            </Button>
            <Button variant="text" sx={{ textTransform: 'none' }}>
              View all notifications
            </Button>
            <Button variant="contained" color="warning">
              Approve as admin (override)
            </Button>
            <Tooltip title="Outputs out of date — regenerate first">
              <span>
                <Button variant="contained" color="success" disabled>
                  Mark disbursed
                </Button>
              </span>
            </Tooltip>
            <Button variant="contained" loading loadingPosition="start" startIcon={<AddIcon />}>
              Saving…
            </Button>
            <Button variant="contained" size="small">
              Small
            </Button>
          </Stack>
        </Section>

        <Section title="Canonical list (ListPage)">
          <DemoList />
        </Section>

        <Section title="Money and dates">
          <Table size="small" sx={{ maxWidth: 640 }}>
            <TableBody>
              {[
                ['Display', <MoneyText key="a" amount={18816.51} />],
                ['Table cell (header "(RM)")', <MoneyText key="b" amount={1250} mode="table" />],
                ['Negative', <MoneyText key="c" amount={-12} />],
                ['Zero', <MoneyText key="d" amount={0} />],
                ['Masked (net pay)', <MoneyText key="e" amount={5123.45} masked maskedLabel="net pay" />],
                ['Date', <DateText key="f" value="2027-05-05" />],
                ['Date-time (MYT)', <DateText key="g" value="2026-11-15T06:32:00Z" mode="datetime" />],
                ['Month', <DateText key="h" value="2027-11-01" mode="month" />],
                ['Empty', <DateText key="i" value={null} />],
              ].map(([label, node]) => (
                <TableRow key={label as string}>
                  <TableCell sx={{ color: 'text.secondary' }}>{label}</TableCell>
                  <TableCell align="right">{node}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <Section title="Portal Home (synthetic data)">
          <EmployeeHome displayName="Sample Employee A" roleLabel="Manager" data={DEMO_HOME} />
        </Section>

        <Section title="Admin dashboard (synthetic data; Missing payroll data shows the failed-tile state)">
          <AdminDashboard data={SAMPLE_ADMIN_DASHBOARD} preview />
        </Section>

        <Section title="Report viewer — Leave balances (synthetic data, W2-007 R3)">
          <ReportViewer
            def={{ id: 'leave-balances', name: 'Leave balances', description: 'Balances per employee and leave type as at a date, by department.', screenId: 'S-RP-10', sensitive: 'no', loadsOnSearch: true }}
            result={SAMPLE_REPORT_RESULT}
            error={null}
            options={SAMPLE_REPORT_OPTIONS}
            today="2026-11-26"
            preview
          />
        </Section>

        <Section title="Monthly payroll-input pack (synthetic data, W2-007 R5)">
          <PayrollInputPack pack={SAMPLE_PAYROLL_PACK} today="2026-11-26" preview />
        </Section>

        <Section title="KPI tiles — pastel strip (max 4, dashboards and Employees list)">
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' } }}>
            {PASTEL_ORDER.map((hue, i) => (
              <KpiTile
                key={hue}
                variant="pastel"
                hue={hue}
                label={['Active employees', 'On probation', 'Notice period', 'Profiles complete'][i]}
                value={[42, 6, 2, '94%'][i]}
                subLine={['+3 this month', 'Due in 30 days: 2', 'Last day 31/12/2026', 'Synthetic data'][i]}
                href={i < 2 ? '#' : undefined}
              />
            ))}
          </Box>
        </Section>

        <Section title="KPI tiles — quiet (money and approval screens)">
          <Box sx={GRID_SX}>
            <KpiTile label="Active headcount" value={42} tone="violet" href="#" />
            <KpiTile label="Pending approvals" value={5} secondary="(2 at Admin level)" tone="warning" href="#" />
            <KpiTile label="Rejected" value={0} tone="grey" />
            <KpiTile label="Awaiting approval" value={6} secondary={<MoneyText amount={1204.1} />} tone="warning" href="#" />
            <KpiTile label="Broken tile" tone="error" error={{ onRetry: () => toast.info('Retrying…') }} />
            <KpiTile label="Loading" loading />
          </Box>
        </Section>

        <Section title="Dialogs and toasts">
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Button variant="outlined" color="error" onClick={() => setConfirm('destructive')}>
              Delete (confirm)
            </Button>
            <Button variant="contained" color="success" onClick={() => setConfirm('positive')}>
              Mark disbursed (confirm)
            </Button>
            <Button variant="outlined" color="error" onClick={() => setReason(true)}>
              Reject (reason)
            </Button>
            <Button variant="outlined" color="inherit" onClick={() => toast.success('Saved.', { label: 'View', href: '/dev/components' })}>
              Success toast
            </Button>
            <Button variant="outlined" color="inherit" onClick={() => toast.info('Export started — we’ll notify you')}>
              Info toast
            </Button>
          </Stack>
          <ConfirmDialog
            open={confirm === 'destructive'}
            title="Delete CL-2026-00102?"
            body="This cannot be undone."
            confirmLabel="Delete"
            destructive
            onConfirm={async () => {
              await new Promise((r) => setTimeout(r, 500));
              setConfirm(null);
              toast.success('Deleted.');
            }}
            onClose={() => setConfirm(null)}
          />
          <ConfirmDialog
            open={confirm === 'positive'}
            title="Mark PB-2026-011 disbursed?"
            body={
              <Box sx={{ p: 1.5, borderRadius: 1, bgcolor: 'tone.success.bg', color: 'success.dark' }}>
                <Typography variant="body2">
                  11 claims for 6 employees, <MoneyText amount={2140.6} /> will become Disbursed and each employee will be notified.
                </Typography>
              </Box>
            }
            confirmLabel="Mark disbursed"
            tone="success"
            onConfirm={() => {
              setConfirm(null);
              toast.success('Batch marked disbursed.');
            }}
            onClose={() => setConfirm(null)}
          />
          <ReasonDialog
            open={reason}
            title="Reject claim CL-2026-00031?"
            confirmLabel="Reject claim"
            onConfirm={(r) => {
              setReason(false);
              toast.info(`Rejected with reason (${r.length} chars).`);
            }}
            onClose={() => setReason(false)}
          />
        </Section>

        <Section title="Empty, error and loading states">
          <Stack spacing={2}>
            <Card variant="outlined">
              <EmptyState title="No claims yet." actions={<Button variant="contained">New claim</Button>} />
            </Card>
            <Card variant="outlined">
              <EmptyState kind="filtered" title="No claims match these filters." actions={<Button variant="outlined" color="inherit">Clear</Button>} />
            </Card>
            <ErrorState kind="tile" onRetry={() => toast.info('Retrying…')} />
            <ErrorState kind="banner" onRetry={() => toast.info('Retrying…')} />
            <ErrorState kind="card" reference="PRET-REF-000123" onRetry={() => toast.info('Retrying…')} />
            <Card variant="outlined">
              <TableSkeleton />
            </Card>
            <Box sx={GRID_SX}>
              <TileSkeleton />
              <TileSkeleton />
            </Box>
            <DetailHeaderSkeleton />
            <Box sx={{ maxWidth: 360 }}>
              <CardListSkeleton count={2} />
            </Box>
          </Stack>
        </Section>

        <Section title="Inputs">
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' } }}>
            <TextField label="Work email" required helperText="Use your @interact.com.my address" />
            <TextField label="Postcode" required error helperText="Postcode must be 5 digits." defaultValue="4321" />
            <TextField label="Disabled" disabled defaultValue="Fixed by policy" />
            <DateFilter label="Transaction date" value="2026-11-15" onChange={() => undefined} />
          </Box>
        </Section>

        <Section title="Typography">
          <Stack spacing={1}>
            <Typography variant="h1">h1 PRET 32/40</Typography>
            <Typography variant="h2">h2 28/36</Typography>
            <Typography variant="h3">h3 Page title 26/34</Typography>
            <Typography variant="h4">h4 Dialog title 20/28</Typography>
            <Typography variant="h5">h5 Section 18/26</Typography>
            <Typography variant="h6">h6 Card title 16/24</Typography>
            <Typography variant="subtitle1">subtitle1 Person name 16/24</Typography>
            <Typography variant="subtitle2">subtitle2 Nav label 14/20</Typography>
            <Typography variant="body1">body1 Form values 15/22 (phone 16/24)</Typography>
            <Typography variant="body2">body2 Table cells 14/20</Typography>
            <Typography variant="caption">caption Timestamps 12/18</Typography>
            <Typography variant="overline">overline Section label 12/16</Typography>
            <Typography variant="kpi">1,234</Typography>
          </Stack>
        </Section>
      </Stack>
    </Box>
  );
}

/** Synthetic portal Home data for the gallery (no real people or amounts). */
const DEMO_HOME: HomeData = {
  balances: [
    { id: 'al', name: 'Annual leave', available: 12.5, earnedToDate: 14, colorIndex: 0 },
    { id: 'sl', name: 'Sick leave', available: 11, colorIndex: 1 },
    { id: 'rl', name: 'Replacement leave', available: 1, colorIndex: 2, expiring: { days: 1, date: '2026-12-31' } },
    { id: 'hl', name: 'Hospitalisation leave', available: 60, colorIndex: 3 },
    { id: 'ml', name: 'Maternity leave', available: null, noBalanceLabel: '98 consecutive days per confinement', colorIndex: 4 },
    { id: 'ul', name: 'Unpaid leave', available: null, colorIndex: 5 },
    { id: 'cl', name: 'Compassionate leave', available: 3, colorIndex: 6 },
  ],
  pendingClaims: { count: 2, amount: 356.59 },
  pendingItems: [
    { ref: 'LV-2026-00121', href: '#', label: 'Annual leave · 1.0 day', set: 'leave', status: 'Pending L1' },
    { ref: 'CL-2026-00043', href: '#', label: 'Parking', set: 'claim', status: 'Submitted' },
  ],
  upcomingLeave: [{ id: 'u1', type: 'Annual leave', colorIndex: 0, from: '2026-12-22', to: '2026-12-24', days: 3 }],
  holidays: [{ date: '2026-12-25', name: 'Christmas Day', weekday: 'Friday', state: 'National' }],
  recentClaims: [{ ref: 'CL-2026-00043', href: '#', title: 'Parking', total: 356.59, status: 'Submitted' }],
  manager: { approvals: 3, onLeaveToday: 1, onLeaveWeek: 2, probationDue: 1, teamClaimsSubmitted: 2 },
};
