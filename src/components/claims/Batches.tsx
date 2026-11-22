'use client';

// Month-end disbursement (F-CLM-14/15/17/23/26/27, D12, D16, D6, D23) — ADM / SA only.
// C9  · Disbursement batches — S-CL-09 · /claims/batches
// C10 · New month-end batch — S-CL-10 · /claims/batches/new (Step 1 Month & cut-off · Step 2 Select claims · Step 3 Review & create)
// C11 · Batch detail — S-CL-11 · /claims/batches/{no} (Claims · By employee · Outputs · History; actions by status)
// C12 · HLB claims payment list — S-CL-12 · /claims/batches/{no}/payment-list (D31: full account numbers on screen for ADM/SA; every view access-logged)
// C13 · Mark batch disbursed — dialog (payment date ≤ today, HLB reference 0/50, notes)
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import {
  BATCH_STATUS_LABELS,
  BATCH_STATUSES,
  HLB_MANUAL_BANNER,
  OUTPUT_KIND_LABELS,
  PAYMENT_METHOD_LABELS,
  type BatchCandidateRow,
  type BatchCandidates,
  type BatchDefaults,
  type BatchDetail,
  type BatchListPage,
  type BatchListParams,
  type BatchPayeeRow,
  type BatchPreview,
  type BatchRow,
  type PaymentListReport,
} from '@/server/contracts/claims';
import {
  addBatchClaims,
  cancelBatch,
  createBatch,
  exportBatchClaimsCsv,
  exportBatchesCsv,
  fetchBatchCandidates,
  fetchBatchDefaults,
  generateBatchOutputs,
  getExportFileUrl,
  markBatchDisbursed,
  previewBatch,
  removeBatchClaim,
  submitBatchForApproval,
} from '@/server/actions/claims';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import MoneyText from '../MoneyText';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ReasonDialog from '../dialogs/ReasonDialog';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import FormDialog from '../forms/FormDialog';
import { useActionRunner } from '../forms/useActionRunner';
import RecordFooter from '../forms/RecordFooter';
import { DateInput, FormGrid, FullRow, TextInput } from '../forms/fields';
import { KVGrid, MiniTable, ProfileTabs, useTabParam } from '../employees/ui';
import { formatAmount, formatDate, formatDateTime, formatMoney, sumMoney, todayMyt } from '@/lib/format';
import { useIdempotencyKey } from '../leave/common';
import type { PickedPerson } from '../leave/pickers';
import { DecisionDialog } from '../approvals/DecisionDialog';
import { BatchStatusChip, ClaimEmployeePicker, ClaimStatusChip, MoneyCell, claimYearOptions, monthText, openDownload } from './common';
import { AttachmentBundleDialog } from './AdminDialogs';
import { BATCH_FILTERS } from './filters';

const card = { p: { xs: 2, sm: 3 } } as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// =============================================================================================
// C9 list
// =============================================================================================
export function BatchesList({ page, params, currentYear }: { page: BatchListPage; params: BatchListParams; currentYear: number }) {
  const toast = useToast();
  const list = useServerList({ filters: BATCH_FILTERS, sort: { key: 'month', direction: 'desc' } });
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<BatchRow>[] = [
    { key: 'batchNo', header: 'Batch no.', value: (r) => r.batchNo },
    { key: 'month', header: 'Disbursement month', value: (r) => monthText(r.disbursementMonth) },
    { key: 'cutoff', header: 'Approval cut-off', kind: 'date', sortable: false, priority: 'low', value: (r) => formatDate(r.cutoffDate), render: (r) => <DateText value={r.cutoffDate} /> },
    { key: 'count', header: 'Count', align: 'right', sortable: false, value: (r) => r.claimCount },
    { key: 'total', header: 'Total (RM)', kind: 'money', value: (r) => formatAmount(r.total), render: (r) => <MoneyCell v={r.total} /> },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => BATCH_STATUS_LABELS[r.status], render: (r) => <BatchStatusChip status={r.status} /> },
    { key: 'paid', header: 'Payment date', kind: 'date', sortable: false, priority: 'low', value: (r) => formatDate(r.paymentDate), render: (r) => <DateText value={r.paymentDate} /> },
    { key: 'ref', header: 'Payment reference', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.paymentReference ?? '' },
    { key: 'prep', header: 'Prepared by', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.preparedByName },
    ...(page.saApprovalOn ? ([{ key: 'appr', header: 'Approved by', sortable: false, priority: 'low', hideOnCard: true, value: (r: BatchRow) => r.approvedByName ?? '' }] as ListColumn<BatchRow>[]) : []),
    { key: 'outputs', header: 'Outputs', sortable: false, hideOnCard: true, value: (r) => (r.outputs === 'current' ? '✓ current' : r.outputs === 'out_of_date' ? '⚠ out of date' : '') },
  ];
  return (
    <Stack spacing={2}>
      {page.unbatched && page.unbatched.count > 0 && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" component={NextLink} href="/claims/batches/new">
              New month-end batch
            </Button>
          }
        >
          {page.unbatched.count} approved {page.unbatched.count === 1 ? 'claim' : 'claims'} ({formatMoney(page.unbatched.total)}) {page.unbatched.count === 1 ? 'is' : 'are'} not in a batch yet.
        </Alert>
      )}
      <ListPage<BatchRow>
        itemName={{ singular: 'batch', plural: 'disbursement batches' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Batch no." />,
          <SelectFilter key="y" label="Year" value={d.year} onChange={(v) => set('year', v)} options={claimYearOptions(currentYear + 1, 4)} />,
          <SelectFilter key="m" label="Month" value={d.month} onChange={(v) => set('month', v)} options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />,
          <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={BATCH_STATUSES.map((s) => ({ value: s, label: BATCH_STATUS_LABELS[s] }))} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'New month-end batch', href: '/claims/batches/new' }}
        onExport={async () => {
          const res = await exportBatchesCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'disbursement-batches', res.content);
          else toast.info(res.error);
        }}
        columns={columns}
        rows={page.rows}
        total={page.total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/claims/batches/${encodeURIComponent(r.batchNo)}`}
        getRowRef={(r) => r.batchNo}
        empty={{ title: 'No disbursement batches yet.' }}
      />
    </Stack>
  );
}

// =============================================================================================
// Payee table (C10 step 3, C11 By employee) — account numbers masked
// =============================================================================================
function PayeeTable({ rows, showBank }: { rows: BatchPayeeRow[]; showBank: boolean }) {
  return (
    <MiniTable
      caption="Payees"
      rows={rows}
      getRowId={(r) => r.employee.id}
      empty="No payees."
      columns={[
        { key: 'e', header: 'Employee', render: (r) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}` },
        ...(showBank
          ? [
              { key: 'b', header: 'Bank', render: (r: BatchPayeeRow) => r.bankName ?? (r.paymentMethod && r.paymentMethod !== 'bank_transfer' ? PAYMENT_METHOD_LABELS[r.paymentMethod] : '—') },
              { key: 'a', header: 'Account', render: (r: BatchPayeeRow) => <span className="pret-tnum">{r.accountMasked ?? '—'}</span> },
            ]
          : []),
        { key: 'c', header: 'Claims', render: (r) => (r.claimNos.length ? r.claimNos.join(', ') : r.claimCount) },
        { key: 'm', header: 'Amount (RM)', align: 'right', render: (r) => <MoneyCell v={r.amount} /> },
        ...(showBank
          ? [
              {
                key: 'w',
                header: 'Bank details',
                render: (r: BatchPayeeRow) => (
                  <Stack spacing={0.25}>
                    {!r.bankComplete && r.paymentMethod === 'bank_transfer' && <Typography variant="body2" color="error">✕ incomplete</Typography>}
                    {r.bankComplete && <Typography variant="body2" sx={{ color: '#198754' }}>✓ complete</Typography>}
                    {r.bankChangedAfterExport && <Typography variant="body2" sx={{ color: '#B45309' }}>⚠ Bank changed after export</Typography>}
                  </Stack>
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

// =============================================================================================
// Candidate picker table (C10 step 2, C11 ADD CLAIMS)
// =============================================================================================
function CandidateTable({ rows, selected, onChange }: { rows: BatchCandidateRow[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const all = rows.length > 0 && rows.every((r) => selected.includes(r.claimId));
  return (
    <TableContainer sx={{ maxHeight: 520 }}>
      <Table size="small" stickyHeader aria-label="Approved claims">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox checked={all} indeterminate={!all && selected.length > 0} onChange={() => onChange(all ? [] : rows.map((r) => r.claimId))} slotProps={{ input: { 'aria-label': 'Select all claims' } }} />
            </TableCell>
            <TableCell>Claim no.</TableCell>
            <TableCell>Employee</TableCell>
            <TableCell>Department</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Approved on</TableCell>
            <TableCell>Approved by</TableCell>
            <TableCell align="right">Total (RM)</TableCell>
            <TableCell>Bank details</TableCell>
            <TableCell>Payment method</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const on = selected.includes(r.claimId);
            return (
              <TableRow key={r.claimId} hover selected={on}>
                <TableCell padding="checkbox">
                  <Checkbox checked={on} onChange={() => onChange(on ? selected.filter((x) => x !== r.claimId) : [...selected, r.claimId])} slotProps={{ input: { 'aria-label': `Select ${r.claimNo}` } }} />
                </TableCell>
                <TableCell className="pret-tnum">
                  <Link component={NextLink} href={`/approvals/claims/${encodeURIComponent(r.claimNo)}?from=claims`} target="_blank">
                    {r.claimNo}
                  </Link>
                </TableCell>
                <TableCell>
                  {r.employee.name}
                  {r.isSeparated ? ' (separated)' : ''}
                </TableCell>
                <TableCell>{r.department}</TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell className="pret-tnum">{formatDate(r.approvedOn)}</TableCell>
                <TableCell>{r.approvedByName ?? '—'}</TableCell>
                <TableCell align="right">
                  <MoneyCell v={r.total} />
                </TableCell>
                <TableCell>{r.bankComplete ? '✓ complete' : <Typography component="span" variant="body2" color="error">✕ missing</Typography>}</TableCell>
                <TableCell>{r.paymentMethod ? PAYMENT_METHOD_LABELS[r.paymentMethod] : '—'}</TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={10}>
                <Typography color="text.secondary" sx={{ py: 2 }}>
                  No approved claims are waiting for a batch.
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function selectionTotals(rows: BatchCandidateRow[], ids: string[]) {
  const sel = rows.filter((r) => ids.includes(r.claimId));
  return { count: sel.length, total: sumMoney(sel.map((r) => r.total)), sst: sumMoney(sel.map((r) => r.totalSst)), employees: new Set(sel.map((r) => r.employee.id)).size };
}

function CandidateFilters({
  departments,
  value,
  onChange,
}: {
  departments: { id: string; label: string }[];
  value: { approvedFrom: string; approvedTo: string; employee: PickedPerson | null; departmentId: string };
  onChange: (v: Partial<{ approvedFrom: string; approvedTo: string; employee: PickedPerson | null; departmentId: string }>) => void;
}) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <DateInput label="Approved from" value={value.approvedFrom} onChange={(v) => onChange({ approvedFrom: v })} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <DateInput label="Approved to" value={value.approvedTo} onChange={(v) => onChange({ approvedTo: v })} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <ClaimEmployeePicker label="Employee" value={value.employee} onChange={(p) => onChange({ employee: p })} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6, md: 3 }}>
        <TextField select fullWidth label="Department" value={value.departmentId} onChange={(e) => onChange({ departmentId: e.target.value })} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}>
          <option value="">All</option>
          {departments.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </TextField>
      </Grid>
    </Grid>
  );
}

function useCandidates(cutoffDate: string, filters: { approvedFrom: string; approvedTo: string; employee: PickedPerson | null; departmentId: string }, batchId?: string, enabled = true) {
  const [data, setData] = React.useState<BatchCandidates | null>(null);
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!enabled || !/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) return;
    let alive = true;
    setState('loading');
    fetchBatchCandidates({
      cutoffDate,
      batchId,
      employeeId: filters.employee?.id,
      departmentIds: filters.departmentId ? [filters.departmentId] : undefined,
      approvedFrom: filters.approvedFrom || undefined,
      approvedTo: filters.approvedTo || undefined,
    })
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setData({ rows: r.rows, inOtherBatches: r.inOtherBatches });
          setState('idle');
        } else {
          setError(r.error);
          setState('error');
        }
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, [enabled, cutoffDate, batchId, filters.employee?.id, filters.departmentId, filters.approvedFrom, filters.approvedTo, retry]);
  return { data, state, error, retry: () => setRetry((x) => x + 1) };
}

// =============================================================================================
// C10 new month-end batch
// =============================================================================================
export function NewBatchWizard({ defaults: initial, departments }: { defaults: BatchDefaults; departments: { id: string; label: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  const [defaults, setDefaults] = React.useState(initial);
  const [f, setF] = React.useState({ disbursementMonth: initial.disbursementMonth, cutoffDate: initial.cutoffDate, plannedPaymentDate: initial.plannedPaymentDate, notes: '' });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [filters, setFilters] = React.useState({ approvedFrom: '', approvedTo: '', employee: null as PickedPerson | null, departmentId: '' });
  const [selected, setSelected] = React.useState<string[] | null>(null);
  const [preview, setPreview] = React.useState<BatchPreview | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [key] = useIdempotencyKey();
  const cands = useCandidates(f.cutoffDate, filters, undefined, step >= 1);
  React.useEffect(() => {
    if (cands.data && selected === null) setSelected(cands.data.rows.filter((r) => r.preselected).map((r) => r.claimId));
  }, [cands.data, selected]);
  const rows = cands.data?.rows ?? [];
  const sel = selected ?? [];
  const tot = selectionTotals(rows, sel);

  const changeMonth = async (m: string) => {
    setF((x) => ({ ...x, disbursementMonth: m }));
    if (!/^\d{4}-\d{2}$/.test(m)) return;
    const r = await fetchBatchDefaults({ disbursementMonth: m });
    if (r.ok) {
      setDefaults(r);
      setF((x) => ({ ...x, cutoffDate: r.cutoffDate, plannedPaymentDate: x.plannedPaymentDate || r.plannedPaymentDate }));
      setSelected(null);
    }
  };
  const next1 = () => {
    const e: Record<string, string> = {};
    if (!/^\d{4}-\d{2}$/.test(f.disbursementMonth)) e.disbursementMonth = 'Select a month.';
    if (!f.cutoffDate) e.cutoffDate = 'Enter the approval cut-off date.';
    if (!f.plannedPaymentDate) e.plannedPaymentDate = 'Enter the planned payment date.';
    else if (f.plannedPaymentDate < todayMyt()) e.plannedPaymentDate = 'Planned payment date must be today or later.';
    setErrors(e);
    if (!Object.keys(e).length) setStep(1);
  };
  const next2 = async () => {
    if (sel.length === 0) return setError('Select at least one claim.');
    setBusy(true);
    setError(null);
    try {
      const r = await previewBatch({ claimIds: sel });
      if (r.ok) {
        setPreview(r);
        setStep(2);
      } else setError(r.error);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await createBatch({ disbursementMonth: f.disbursementMonth, cutoffDate: f.cutoffDate, plannedPaymentDate: f.plannedPaymentDate, notes: f.notes || null, claimIds: sel, idempotencyKey: key });
      if (r.ok) {
        toast.success(`${r.batchNo} created (Draft). Employees are notified in-app.`);
        router.push(`/claims/batches/${encodeURIComponent(r.batchNo)}`);
      } else {
        setError(r.error);
        setErrors(r.fieldErrors ?? {});
      }
    } catch {
      setError('Something went wrong. The batch was not created — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stepper activeStep={step} alternativeLabel>
        {['Month & cut-off', 'Select claims', 'Review & create'].map((l) => (
          <Step key={l}>
            <StepLabel>{l}</StepLabel>
          </Step>
        ))}
      </Stepper>
      {error && <Alert severity="error">{error}</Alert>}
      {step === 0 && (
        <Card>
          <CardContent sx={card}>
            {defaults.regularExists && <Alert severity="info" sx={{ mb: 2 }}>A regular batch already exists for {monthText(f.disbursementMonth)} — this one is an additional batch (e.g. claims added after an undo).</Alert>}
            <FormGrid>
              <TextField type="month" label="Disbursement month" required value={f.disbursementMonth} onChange={(e) => void changeMonth(e.target.value)} error={Boolean(errors.disbursementMonth)} helperText={errors.disbursementMonth ?? monthText(f.disbursementMonth)} slotProps={{ inputLabel: { shrink: true } }} fullWidth />
              <DateInput label="Approval cut-off date" required value={f.cutoffDate} onChange={(v) => (setF((x) => ({ ...x, cutoffDate: v })), setSelected(null))} error={errors.cutoffDate} helper="Default: last day of the month. Claims approved on or before it are pre-selected." />
              <DateInput label="Planned payment date" required value={f.plannedPaymentDate} onChange={(v) => setF((x) => ({ ...x, plannedPaymentDate: v }))} minDate={todayMyt()} error={errors.plannedPaymentDate} helper="Shown on the HLB payment list." />
              <TextInput label="Route" value="Hong Leong Bank Connect First — manual payment list (D16)" onChange={() => undefined} locked="Single route (D16): HLB manual payment list. PRET sends nothing to the bank." />
              <FullRow>
                <TextInput label="Notes" value={f.notes} onChange={(v) => setF((x) => ({ ...x, notes: v }))} maxLength={500} multiline minRows={2} />
              </FullRow>
            </FormGrid>
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button variant="outlined" color="inherit" component={NextLink} href="/claims/batches">
                Cancel
              </Button>
              <Button variant="contained" onClick={next1}>
                Next
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
      {step === 1 && (
        <Card>
          <CardContent sx={card}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Approved claims not in another open batch. Claims approved on or before {formatDate(f.cutoffDate)} are pre-selected. Deselected claims stay Approved for the next batch.
            </Typography>
            <CandidateFilters departments={departments} value={filters} onChange={(p) => setFilters((x) => ({ ...x, ...p }))} />
            <Stack direction="row" spacing={1} sx={{ my: 1.5 }} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button size="small" onClick={() => setSelected(rows.map((r) => r.claimId))}>
                Select all
              </Button>
              <Button size="small" onClick={() => setSelected([])}>
                Clear selection
              </Button>
              {cands.data && cands.data.inOtherBatches.count > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {cands.data.inOtherBatches.count} claims are in {cands.data.inOtherBatches.batchNos.join(', ')}.
                </Typography>
              )}
            </Stack>
            {cands.state === 'error' ? (
              <Alert severity="error" action={<Button onClick={cands.retry}>Retry</Button>}>
                {cands.error ?? 'Could not load the approved claims.'}
              </Alert>
            ) : cands.state === 'loading' && !cands.data ? (
              <Typography color="text.secondary">Loading approved claims…</Typography>
            ) : (
              <CandidateTable rows={rows} selected={sel} onChange={setSelected} />
            )}
            <Typography variant="body1" sx={{ mt: 2 }} className="pret-tnum" aria-live="polite">
              <strong>{tot.count}</strong> claims · total <MoneyText amount={tot.total} bold /> · SST <MoneyText amount={tot.sst} /> · <strong>{tot.employees}</strong> employees
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button variant="outlined" color="inherit" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button variant="contained" onClick={next2} loading={busy} disabled={sel.length === 0}>
                Next
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
      {step === 2 && preview && (
        <Card>
          <CardContent sx={card}>
            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
              {monthText(f.disbursementMonth)} · cut-off {formatDate(f.cutoffDate)} · planned payment {formatDate(f.plannedPaymentDate)}
            </Typography>
            <Typography sx={{ mb: 2 }} className="pret-tnum">
              {preview.count} claims · {preview.employees} employees · Total <MoneyText amount={preview.total} bold /> · SST <MoneyText amount={preview.totalSst} />
            </Typography>
            {preview.incompleteBank.length > 0 && (
              <Alert severity="error" sx={{ mb: 2 }}>
                Employees with incomplete bank details — outputs can&apos;t be generated until they are fixed:{' '}
                {preview.incompleteBank.map((p, i) => (
                  <React.Fragment key={p.id}>
                    {i > 0 && ', '}
                    <Link component={NextLink} href={`/employees/${encodeURIComponent(p.employeeNo ?? '')}?tab=bank`} target="_blank">
                      {p.name}
                    </Link>
                  </React.Fragment>
                ))}
              </Alert>
            )}
            <Typography variant="subtitle1" component="h3">
              HLB transfer — per employee
            </Typography>
            <PayeeTable rows={preview.payees} showBank />
            {preview.chequeCash.length > 0 && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle1" component="h3">
                  Pay by cheque / cash (not on the HLB list — D23)
                </Typography>
                <PayeeTable rows={preview.chequeCash} showBank={false} />
              </Box>
            )}
            <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
              <Button variant="outlined" color="inherit" onClick={() => setStep(1)} disabled={busy}>
                Back
              </Button>
              <Button variant="contained" onClick={create} loading={busy}>
                Create batch
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}

// =============================================================================================
// C13 mark disbursed dialog
// =============================================================================================
function MarkDisbursedDialog({ open, batch, onClose }: { open: boolean; batch: BatchDetail; onClose: () => void }) {
  const r = useActionRunner();
  const [f, setF] = React.useState({ paymentDate: todayMyt(), paymentReference: '', notes: '' });
  const [dirty, setDirty] = React.useState(false);
  const set = (p: Partial<typeof f>) => (setDirty(true), setF((x) => ({ ...x, ...p })));
  return (
    <FormDialog
      open={open}
      title={`Mark ${batch.batchNo} disbursed`}
      submitLabel="Mark disbursed"
      onClose={onClose}
      dirty={dirty}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      fieldLabels={{ paymentDate: 'Payment date', paymentReference: 'HLB payment reference' }}
      onSubmit={async () => {
        const res = await r.run(() => markBatchDisbursed({ batchId: batch.id, paymentDate: f.paymentDate, paymentReference: f.paymentReference, notes: f.notes || null, expectedVersion: batch.version }), {
          success: (x) => `${x.claims} claims disbursed — employees notified.`,
        });
        if (res?.ok) onClose();
      }}
    >
      <Typography sx={{ mb: 2 }}>
        {batch.claimCount} claims for {batch.employeeCount} employees, {formatMoney(batch.total)} will become Disbursed and each employee will be notified.
      </Typography>
      <FormGrid>
        <DateInput label="Payment date" required value={f.paymentDate} onChange={(v) => set({ paymentDate: v })} maxDate={todayMyt()} error={r.fieldErrors.paymentDate} />
        <TextInput label="HLB payment reference" required value={f.paymentReference} onChange={(v) => set({ paymentReference: v })} maxLength={50} counter error={r.fieldErrors.paymentReference} />
        <FullRow>
          <TextInput label="Notes" value={f.notes} onChange={(v) => set({ notes: v })} maxLength={500} multiline minRows={2} />
        </FullRow>
      </FormGrid>
    </FormDialog>
  );
}

function AddClaimsDialog({ open, batch, departments, onClose }: { open: boolean; batch: BatchDetail; departments: { id: string; label: string }[]; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [filters, setFilters] = React.useState({ approvedFrom: '', approvedTo: '', employee: null as PickedPerson | null, departmentId: '' });
  const [sel, setSel] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const cands = useCandidates(batch.cutoffDate, filters, batch.id, open);
  const rows = cands.data?.rows ?? [];
  const tot = selectionTotals(rows, sel);
  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title={`Add claims to ${batch.batchNo}`}
      maxWidth="md"
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            loading={busy}
            disabled={sel.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await addBatchClaims({ batchId: batch.id, claimIds: sel, expectedVersion: batch.version });
                if (r.ok) {
                  toast.success(`${sel.length} claims added.`);
                  onClose();
                  router.refresh();
                } else toast.info(r.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            Add {sel.length || ''} claims
          </Button>
        </>
      }
    >
      <CandidateFilters departments={departments} value={filters} onChange={(p) => setFilters((x) => ({ ...x, ...p }))} />
      <Box sx={{ mt: 2 }}>{cands.state === 'loading' && !cands.data ? <Typography color="text.secondary">Loading…</Typography> : <CandidateTable rows={rows} selected={sel} onChange={setSel} />}</Box>
      <Typography sx={{ mt: 1 }} className="pret-tnum">
        {tot.count} selected · <MoneyText amount={tot.total} />
      </Typography>
    </ResponsiveDialog>
  );
}

// =============================================================================================
// C11 batch detail
// =============================================================================================
export function BatchDetailView({ batch: b, departments }: { batch: BatchDetail; departments: { id: string; label: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [dlg, setDlg] = React.useState<'disbursed' | 'cancel' | 'add' | 'zip' | 'approve' | 'reject' | null>(null);
  const [remove, setRemove] = React.useState<{ claimId: string; claimNo: string } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const tabs = [
    { value: 'claims', label: 'Claims', count: b.claims.length },
    { value: 'employees', label: 'By employee', count: b.byEmployee.length },
    { value: 'outputs', label: 'Outputs', count: b.outputs.length },
    { value: 'history', label: 'History' },
  ];
  const [tab, setTab] = useTabParam(tabs, 'claims');
  const run = async (label: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) => {
    setBusy(label);
    try {
      const r = await fn();
      if (r.ok) {
        toast.success(success);
        router.refresh();
      } else toast.info(r.error);
    } catch {
      toast.info('Something went wrong. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  };
  const dl = (exportFileId: string) => openDownload(() => getExportFileUrl({ exportFileId }), (m) => toast.info(m));
  const t = b.task;

  const markBtn = b.can.markDisbursed || b.markDisbursedBlockedReason ? (
    <Tooltip title={b.markDisbursedBlockedReason ?? ''} disableHoverListener={!b.markDisbursedBlockedReason}>
      <span>
        <Button variant="contained" color="success" disabled={!b.can.markDisbursed} onClick={() => setDlg('disbursed')}>
          Mark disbursed
        </Button>
      </span>
    </Tooltip>
  ) : null;

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={card}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="h4" component="p" className="pret-tnum">
              {b.batchNo} · {monthText(b.disbursementMonth)} · cut-off {formatDate(b.cutoffDate)}
            </Typography>
            <BatchStatusChip status={b.status} outOfDate={b.outputsOutOfDate} />
            {!b.isRegular && <Typography variant="body2" color="text.secondary">(additional batch)</Typography>}
          </Stack>
          <Typography sx={{ mt: 1 }} className="pret-tnum">
            {b.claimCount} claims · {b.employeeCount} employees · Total <MoneyText amount={b.total} bold /> · SST <MoneyText amount={b.totalSst} />
          </Typography>
          <Typography variant="body2" color="text.secondary" className="pret-tnum">
            Planned payment {formatDate(b.plannedPaymentDate)} · Prepared by {b.preparedByName} {formatDateTime(b.preparedAt)}
            {b.approvedByName ? ` · Approved by ${b.approvedByName} ${formatDateTime(b.approvedAt)}` : ''}
            {b.paymentDate ? ` · Paid ${formatDate(b.paymentDate)} ref ${b.paymentReference ?? ''}` : ''}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
            <LockIcon sx={{ fontSize: 14 }} /> {b.routeNote}
          </Typography>
          {b.notes && <Typography variant="body2" sx={{ mt: 0.5 }}>Notes: {b.notes}</Typography>}
          {b.cancelReason && <Alert severity="info" sx={{ mt: 1 }}>Cancelled by {b.cancelledByName} at {formatDateTime(b.cancelledAt)}: {b.cancelReason}</Alert>}
          {b.outputsOutOfDate && <Alert severity="warning" sx={{ mt: 1 }}>⚠ Outputs out of date{b.outOfDateReason ? ` — ${b.outOfDateReason}` : ''}. Regenerate before marking the batch disbursed.</Alert>}
          {b.bankChangedAfterExport && <Alert severity="warning" sx={{ mt: 1 }}>Bank details of at least one employee changed after export — regenerate the payment list before keying it into HLB.</Alert>}
          {b.blockers.length > 0 && (
            <Alert severity="error" sx={{ mt: 1 }}>
              Can&apos;t generate outputs:
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {b.blockers.map((x) => (
                  <li key={x.label}>
                    {x.kind === 'bank' ? 'Bank details incomplete: ' : 'No AutoCount GL account: '}
                    {x.href ? (
                      <Link component={NextLink} href={x.href}>
                        {x.label}
                      </Link>
                    ) : (
                      x.label
                    )}
                  </li>
                ))}
              </ul>
            </Alert>
          )}
          {t && !t.canDecide && t.blockedReason && <Alert severity="info" sx={{ mt: 1 }}>{t.blockedReason}</Alert>}
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
            {b.can.generateOutputs && (
              <Button variant="contained" loading={busy === 'gen'} onClick={() => run('gen', () => generateBatchOutputs({ batchId: b.id }), 'Outputs generated — HLB payment list and AutoCount file ready.')}>
                Generate outputs
              </Button>
            )}
            {b.can.regenerateOutputs && (
              <Button variant="outlined" loading={busy === 'gen'} onClick={() => run('gen', () => generateBatchOutputs({ batchId: b.id }), 'Outputs regenerated (new version).')}>
                Regenerate outputs
              </Button>
            )}
            {markBtn}
            {b.can.submitForApproval && (
              <Button variant="outlined" loading={busy === 'sub'} onClick={() => run('sub', () => submitBatchForApproval({ batchId: b.id }), 'Submitted to Super Admin for approval.')}>
                Submit for approval
              </Button>
            )}
            {t?.canDecide && (
              <>
                <Button variant="contained" onClick={() => setDlg('approve')}>
                  Approve batch
                </Button>
                <Button variant="outlined" color="error" onClick={() => setDlg('reject')}>
                  Return
                </Button>
              </>
            )}
            {b.can.viewPaymentList && (
              <Button variant="outlined" component={NextLink} href={`/claims/batches/${encodeURIComponent(b.batchNo)}/payment-list`}>
                View payment list
              </Button>
            )}
            {b.can.downloadAttachments && (
              <Button variant="outlined" onClick={() => setDlg('zip')}>
                Download attachments
              </Button>
            )}
            <Button
              variant="text"
              onClick={async () => {
                const r = await exportBatchClaimsCsv({ batchId: b.id });
                if (r.ok) downloadServerCsv(r.filename || `${b.batchNo}-claims`, r.content);
                else toast.info(r.error);
              }}
            >
              Export .csv
            </Button>
            {b.can.cancel && (
              <Button variant="text" color="error" onClick={() => setDlg('cancel')}>
                Cancel batch
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      <ProfileTabs tabs={tabs} value={tab} onChange={setTab} label="Batch sections" />
      <Card>
        <CardContent sx={card}>
          {tab === 'claims' && (
            <>
              {b.can.addClaims && (
                <Stack direction="row" justifyContent="flex-end" sx={{ mb: 1 }}>
                  <Button variant="contained" onClick={() => setDlg('add')}>
                    Add claims
                  </Button>
                </Stack>
              )}
              <MiniTable
                caption="Claims in batch"
                rows={b.claims}
                getRowId={(x) => x.claimId}
                empty="No claims in this batch."
                columns={[
                  {
                    key: 'n',
                    header: 'Claim no.',
                    render: (x) => (
                      <Link component={NextLink} href={`/approvals/claims/${encodeURIComponent(x.claimNo)}?from=claims`} className="pret-tnum" sx={x.undone ? { textDecoration: 'line-through' } : undefined}>
                        {x.claimNo}
                      </Link>
                    ),
                  },
                  { key: 'e', header: 'Employee', render: (x) => x.employee.name },
                  { key: 't', header: 'Title', render: (x) => (x.undone ? `${x.title} — undone: ${x.undone.reason}` : x.title) },
                  { key: 'a', header: 'Approved on', render: (x) => formatDate(x.approvedOn) || '—' },
                  { key: 'm', header: 'Total (RM)', align: 'right', render: (x) => <MoneyCell v={x.total} /> },
                  { key: 's', header: 'Status', render: (x) => <ClaimStatusChip status={x.status} /> },
                ]}
                rowActions={b.can.removeClaims ? (x) => <Button size="small" color="error" onClick={() => setRemove({ claimId: x.claimId, claimNo: x.claimNo })}>Remove</Button> : undefined}
              />
              <Typography sx={{ mt: 1, textAlign: 'right' }}>
                Total <MoneyText amount={b.total} bold />
              </Typography>
            </>
          )}
          {tab === 'employees' && (
            <>
              <PayeeTable rows={b.byEmployee} showBank />
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                Account numbers are masked here. Full numbers appear only inside the generated HLB payment list (.xlsx / PDF); every download is logged.
              </Typography>
            </>
          )}
          {tab === 'outputs' && (
            <MiniTable
              caption="Output versions"
              rows={b.outputs}
              getRowId={(x) => String(x.version)}
              empty="No outputs generated yet."
              columns={[
                { key: 'v', header: 'Version', render: (x) => x.version },
                { key: 'g', header: 'Generated at', render: (x) => formatDateTime(x.generatedAt) },
                { key: 'b', header: 'By', render: (x) => x.generatedByName ?? '—' },
                { key: 's', header: 'Status', render: (x) => (x.status === 'current' ? 'Current' : x.status === 'out_of_date' ? '⚠ Out of date' : 'Superseded') },
                {
                  key: 'f',
                  header: 'Files',
                  render: (x) => (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                      {x.files.map((file) => (
                        <Button key={file.exportFileId} size="small" variant="outlined" startIcon={<LockIcon />} onClick={() => dl(file.exportFileId)}>
                          {OUTPUT_KIND_LABELS[file.kind]}
                        </Button>
                      ))}
                      {x.status === 'current' && b.can.viewPaymentList && (
                        <Button size="small" component={NextLink} href={`/claims/batches/${encodeURIComponent(b.batchNo)}/payment-list`}>
                          View
                        </Button>
                      )}
                    </Stack>
                  ),
                },
              ]}
            />
          )}
          {tab === 'history' && (
            <MiniTable
              caption="Batch history"
              rows={b.history}
              getRowId={(x) => `${x.at}-${x.event}`}
              empty="No history yet."
              columns={[
                { key: 'at', header: 'At', render: (x) => formatDateTime(x.at) },
                { key: 'e', header: 'Event', render: (x) => x.event },
                { key: 's', header: 'Status', render: (x) => (x.toStatus ? `${x.fromStatus ? `${BATCH_STATUS_LABELS[x.fromStatus]} → ` : ''}${BATCH_STATUS_LABELS[x.toStatus]}` : '—') },
                { key: 'by', header: 'By', render: (x) => x.actorName },
                { key: 'c', header: 'Reason / comment', render: (x) => x.comment ?? '—' },
              ]}
            />
          )}
        </CardContent>
      </Card>
      <RecordFooter meta={b} />

      <MarkDisbursedDialog open={dlg === 'disbursed'} batch={b} onClose={() => setDlg(null)} />
      {dlg === 'add' && <AddClaimsDialog open batch={b} departments={departments} onClose={() => setDlg(null)} />}
      <AttachmentBundleDialog open={dlg === 'zip'} onClose={() => setDlg(null)} input={{ scope: 'batch', batchId: b.id }} scopeLabel={`Batch ${b.batchNo}`} />
      {(dlg === 'approve' || dlg === 'reject') && t && <DecisionDialog open kind={dlg} subject="batch" reference={b.batchNo} taskId={t.taskId} taskVersion={t.version} onClose={() => setDlg(null)} />}
      <ReasonDialog
        open={dlg === 'cancel'}
        title={`Cancel ${b.batchNo}?`}
        confirmLabel="Cancel batch"
        intro="The claims stay Approved and become selectable for the next batch."
        onClose={() => setDlg(null)}
        onConfirm={async (reason) => {
          if (reason.length < 5) return toast.info('Reason must be at least 5 characters.');
          const r = await cancelBatch({ batchId: b.id, reason });
          if (r.ok) {
            toast.success(`${b.batchNo} cancelled.`);
            setDlg(null);
            router.refresh();
          } else toast.info(r.error);
        }}
      />
      <ConfirmDialog
        open={Boolean(remove)}
        title={`Remove ${remove?.claimNo} from ${b.batchNo}?`}
        body="It stays Approved and is proposed for the next batch."
        confirmLabel="Remove"
        destructive
        onClose={() => setRemove(null)}
        onConfirm={async () => {
          if (!remove) return;
          const r = await removeBatchClaim({ batchId: b.id, claimId: remove.claimId, expectedVersion: b.version });
          if (r.ok) {
            toast.success(`${remove.claimNo} removed.`);
            setRemove(null);
            router.refresh();
          } else toast.info(r.error);
        }}
      />
    </Stack>
  );
}

// =============================================================================================
// C12 HLB payment list (on-screen report)
// =============================================================================================
export function PaymentListView({ report: p, batchNo }: { report: PaymentListReport; batchNo: string }) {
  const toast = useToast();
  const h = p.header;
  const dl = (id: string) => openDownload(() => getExportFileUrl({ exportFileId: id }), (m) => toast.info(m));
  return (
    <Stack spacing={2} className="pret-print">
      <Alert severity="info" icon={<LockIcon />}>
        {p.banner || HLB_MANUAL_BANNER}
      </Alert>
      <Typography variant="body2" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <LockIcon sx={{ fontSize: 16 }} /> Viewing is logged — this page shows full bank account numbers.
      </Typography>
      {!p.totals.matches && <Alert severity="error">List total {formatMoney(sumMoney([p.totals.hlb, p.totals.chequeCash]))} doesn&apos;t match batch total {formatMoney(p.totals.batch)}. Do not key this list — report it.</Alert>}
      <Card>
        <CardContent sx={card}>
          <KVGrid
            columns={4}
            items={[
              { label: 'Company', value: h.companyName },
              { label: 'Paying account', value: h.payingAccount },
              { label: 'Batch no.', value: h.batchNo },
              { label: 'Disbursement month', value: monthText(h.disbursementMonth) },
              { label: 'Planned payment date', value: formatDate(h.plannedPaymentDate) },
              { label: 'Count', value: h.count },
              { label: 'Total (RM)', value: <MoneyText amount={h.total} bold /> },
              { label: 'Prepared by / at', value: `${h.preparedByName} · ${formatDateTime(h.preparedAt)}` },
              { label: 'Approved by / at', value: h.approvedByName ? `${h.approvedByName} · ${formatDateTime(h.approvedAt)}` : '', hidden: !h.approvedByName },
              { label: 'Version', value: h.version ?? 'Not generated' },
              { label: 'Generated', value: h.generatedAt ? formatDateTime(h.generatedAt) : '—' },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <TableContainer>
          <Table size="small" aria-label="HLB payment list">
            <TableHead>
              <TableRow>
                <TableCell>No.</TableCell>
                <TableCell>Employee no.</TableCell>
                <TableCell>Beneficiary name (account holder)</TableCell>
                <TableCell>Bank</TableCell>
                <TableCell>Bank code / BIC</TableCell>
                <TableCell>Account no.</TableCell>
                <TableCell align="right">Amount (RM)</TableCell>
                <TableCell>Payment reference</TableCell>
                <TableCell>Payment description</TableCell>
                <TableCell>Beneficiary email</TableCell>
                <TableCell>Claim nos.</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {p.rows.map((r) => (
                <TableRow key={r.no}>
                  <TableCell>{r.no}</TableCell>
                  <TableCell className="pret-tnum">{r.employeeNo}</TableCell>
                  <TableCell>{r.beneficiaryName}</TableCell>
                  <TableCell>{r.bank}</TableCell>
                  <TableCell>{[r.bankCode, r.bic].filter(Boolean).join(' / ')}</TableCell>
                  <TableCell className="pret-tnum" sx={{ whiteSpace: 'nowrap' }}>
                    {r.accountNo}
                  </TableCell>
                  <TableCell align="right">
                    <MoneyCell v={r.amount} />
                  </TableCell>
                  <TableCell>{r.paymentReference}</TableCell>
                  <TableCell>{r.paymentDescription}</TableCell>
                  <TableCell>{r.beneficiaryEmail}</TableCell>
                  <TableCell>{r.claimNos.join(', ')}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={6} sx={{ fontWeight: 700 }}>
                  Total {p.totals.matches ? '✓ matches batch' : '✕ does not match batch'}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 700 }}>
                  <MoneyCell v={p.totals.hlb} />
                </TableCell>
                <TableCell colSpan={4} />
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <Typography variant="caption" color="text.secondary">
        Full account numbers are shown for keying into HLB Connect First. Viewing this list and every download is logged.
      </Typography>
      {p.chequeCash.length > 0 && (
        <Card>
          <CardContent sx={card}>
            <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
              Pay by cheque / cash — not on the HLB list (D23)
            </Typography>
            <MiniTable
              caption="Cheque / cash payees"
              rows={p.chequeCash}
              getRowId={(r) => String(r.no)}
              columns={[
                { key: 'n', header: 'No.', render: (r) => r.no },
                { key: 'e', header: 'Employee no.', render: (r) => r.employeeNo },
                { key: 'm', header: 'Name', render: (r) => r.name },
                { key: 'p', header: 'Method', render: (r) => PAYMENT_METHOD_LABELS[r.method] },
                { key: 'a', header: 'Amount (RM)', align: 'right', render: (r) => <MoneyCell v={r.amount} /> },
                { key: 'c', header: 'Claim nos.', render: (r) => r.claimNos.join(', ') },
              ]}
            />
            <Typography sx={{ mt: 1, textAlign: 'right' }}>
              Cheque / cash total <MoneyText amount={p.totals.chequeCash} bold /> · Batch total <MoneyText amount={p.totals.batch} bold />
            </Typography>
          </CardContent>
        </Card>
      )}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ '@media print': { display: 'none' } }}>
        <Button variant="contained" color="success" startIcon={<LockIcon />} disabled={!p.xlsx} onClick={() => p.xlsx && dl(p.xlsx.exportFileId)}>
          Download .xlsx
        </Button>
        <Button variant="contained" color="success" startIcon={<LockIcon />} disabled={!p.pdf} onClick={() => p.pdf && dl(p.pdf.exportFileId)}>
          Download PDF
        </Button>
        <Button variant="outlined" startIcon={<PrintOutlinedIcon />} onClick={() => window.print()}>
          Print
        </Button>
        <Button variant="text" component={NextLink} href={`/claims/batches/${encodeURIComponent(batchNo)}`}>
          Back to batch
        </Button>
        {!p.xlsx && <Typography variant="body2" color="text.secondary">Generate the outputs on the batch first.</Typography>}
      </Stack>
    </Stack>
  );
}
