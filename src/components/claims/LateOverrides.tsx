'use client';

// C4 · Late-submission overrides — S-CL-04 · /claims/late-overrides · F-CLM-21 · US-CLAIM-026 (UXQ-03)
// List: Filters Employee · Applied from–to · Columns Employee · Claim no. · Line · Transaction date · Days past deadline ·
// Reason · Applied by/at · Used (claim submitted ✓/—) · NEW OVERRIDE · EXPORT .CSV.
// New override: Employee * → that employee's New claim lines older than the deadline (Claim no. · Line · Category ·
// Transaction date · Amount, read-only) with checkboxes · Reason * (≥ 10) · APPLY OVERRIDE (employee notified in-app).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Typography from '@mui/material/Typography';
import type { LateOverrideCandidate, LateOverrideListParams, LateOverrideRow } from '@/server/contracts/claims';
import { applyLateOverride, exportLateOverridesCsv, fetchLateOverrideCandidates } from '@/server/actions/claims';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import FormDialog from '../forms/FormDialog';
import { TextInput } from '../forms/fields';
import { MiniTable } from '../employees/ui';
import { formatDate, formatDateTime } from '@/lib/format';
import type { PickedPerson } from '../leave/pickers';
import { ClaimEmployeePicker, MoneyCell } from './common';
import { LATE_OVERRIDE_FILTERS } from './filters';

export default function LateOverridesList({ rows, total, params, openFor }: { rows: LateOverrideRow[]; total: number; params: LateOverrideListParams; openFor: PickedPerson | null | 'new' }) {
  const toast = useToast();
  const list = useServerList({ filters: LATE_OVERRIDE_FILTERS, sort: { key: 'applied', direction: 'desc' } });
  const [dlg, setDlg] = React.useState<PickedPerson | null | 'new'>(openFor);
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<LateOverrideRow>[] = [
    { key: 'employee', header: 'Employee', value: (r) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}` },
    { key: 'claim', header: 'Claim no.', sortable: false, value: (r) => r.claimNo },
    { key: 'line', header: 'Line(s)', sortable: false, align: 'right', value: (r) => r.lineNo ?? 'All' },
    { key: 'tx', header: 'Transaction date', kind: 'date', sortable: false, value: (r) => formatDate(r.transactionDate) },
    { key: 'days', header: 'Days past deadline', align: 'right', sortable: false, value: (r) => r.daysPastDeadline ?? '' },
    { key: 'reason', header: 'Reason', sortable: false, priority: 'low', value: (r) => r.reason },
    { key: 'applied', header: 'Applied by / at', kind: 'date', value: (r) => `${r.appliedByName} · ${formatDateTime(r.appliedAt)}` },
    { key: 'used', header: 'Used', sortable: false, align: 'center', value: (r) => (r.used ? '✓' : '—') },
  ];
  return (
    <>
      <ListPage<LateOverrideRow>
        itemName={{ singular: 'override', plural: 'late-submission overrides' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Employee, claim no. or reason." />,
          <ClaimEmployeePicker
            key="e"
            label="Employee"
            size="small"
            value={d.employeeId ? { id: d.employeeId, employeeNo: null, name: d.employeeName || 'Selected employee' } : null}
            onChange={(p) => {
              set('employeeId', p?.id ?? '');
              set('employeeName', p ? `${p.name}${p.employeeNo ? ` (${p.employeeNo})` : ''}` : '');
            }}
          />,
          <DateFilter key="f" label="Applied from" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="t" label="Applied to" value={d.to} onChange={(v) => set('to', v)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'New override', onClick: () => setDlg('new') }}
        onExport={async () => {
          const res = await exportLateOverridesCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'late-overrides', res.content);
          else toast.info(res.error);
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/approvals/claims/${encodeURIComponent(r.claimNo)}?from=claims`}
        getRowRef={(r) => r.claimNo}
        empty={{ title: 'No late-submission overrides yet.' }}
      />
      {dlg !== null && <NewOverrideDialog initial={dlg === 'new' ? null : dlg} onClose={() => setDlg(null)} />}
    </>
  );
}

function NewOverrideDialog({ initial, onClose }: { initial: PickedPerson | null; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [emp, setEmp] = React.useState<PickedPerson | null>(initial);
  const [rows, setRows] = React.useState<LateOverrideCandidate[] | null>(null);
  const [sel, setSel] = React.useState<string[]>([]);
  const [reason, setReason] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    setRows(null);
    setSel([]);
    if (!emp) return;
    let alive = true;
    fetchLateOverrideCandidates({ employeeId: emp.id })
      .then((r) => alive && (r.ok ? setRows(r.rows) : setError(r.error)))
      .catch(() => alive && setError('Could not load the claim lines.'));
    return () => {
      alive = false;
    };
  }, [emp]);
  return (
    <FormDialog
      open
      title="New late-submission override"
      submitLabel="Apply override"
      maxWidth="md"
      onClose={onClose}
      dirty={Boolean(emp || reason)}
      saving={saving}
      error={error}
      fieldErrors={fieldErrors}
      fieldLabels={{ employeeId: 'Employee', lineIds: 'Lines', reason: 'Reason' }}
      onSubmit={async () => {
        const fe: Record<string, string> = {};
        if (!emp) fe.employeeId = 'Select the employee.';
        if (sel.length === 0) fe.lineIds = 'Select at least one line.';
        if (reason.trim().length < 10) fe.reason = 'Reason must be at least 10 characters.';
        setFieldErrors(fe);
        if (Object.keys(fe).length || !emp) return;
        setSaving(true);
        setError(null);
        try {
          const r = await applyLateOverride({ employeeId: emp.id, lineIds: sel, reason: reason.trim() });
          if (r.ok) {
            toast.success(`Override applied to ${r.lines} lines — ${emp.name} is notified.`);
            onClose();
            router.refresh();
          } else {
            setError(r.error);
            setFieldErrors(r.fieldErrors ?? {});
          }
        } finally {
          setSaving(false);
        }
      }}
    >
      <Box sx={{ mb: 2 }}>
        <ClaimEmployeePicker label="Employee" required value={emp} onChange={setEmp} error={fieldErrors.employeeId} />
      </Box>
      {emp && rows === null && !error && <Typography color="text.secondary">Loading…</Typography>}
      {rows && rows.length === 0 && <Alert severity="info">This employee has no New claim lines older than the submission deadline.</Alert>}
      {rows && rows.length > 0 && (
        <MiniTable
          caption="Late lines"
          rows={rows}
          getRowId={(r) => r.lineId}
          columns={[
            {
              key: 'x',
              header: '',
              render: (r) => (
                <Checkbox
                  checked={sel.includes(r.lineId)}
                  disabled={r.hasOverride}
                  onChange={() => setSel((s) => (s.includes(r.lineId) ? s.filter((x) => x !== r.lineId) : [...s, r.lineId]))}
                  slotProps={{ input: { 'aria-label': `Select ${r.claimNo} line ${r.lineNo}` } }}
                />
              ),
            },
            { key: 'c', header: 'Claim no.', render: (r) => r.claimNo },
            { key: 'l', header: 'Line', render: (r) => r.lineNo },
            { key: 'k', header: 'Category', render: (r) => r.category },
            { key: 'd', header: 'Transaction date', render: (r) => `${formatDate(r.transactionDate)} (${r.daysPastDeadline} d late)` },
            { key: 'a', header: 'Amount (RM)', align: 'right', render: (r) => <MoneyCell v={r.amount} /> },
            { key: 'o', header: 'Override', render: (r) => (r.hasOverride ? 'Already applied' : '—') },
          ]}
        />
      )}
      {fieldErrors.lineIds && (
        <Typography variant="body2" color="error">
          {fieldErrors.lineIds}
        </Typography>
      )}
      <Box sx={{ mt: 2 }}>
        <TextInput label="Reason" required value={reason} onChange={setReason} maxLength={500} multiline minRows={3} error={fieldErrors.reason} helper="At least 10 characters. The lines get the “Late (override)” flag." />
      </Box>
    </FormDialog>
  );
}
