'use client';

// L14 · Delegations & reassignment — S-LV-14 · /leave/delegations · F-LV-24 · US-LEAVE-031, 032
// List: Filters Approver · Delegate · Active on date · Scope · Status · Columns Approver › · Delegate · From · To · Scope
// (Leave / Claims / Both) · Set by (self / Admin) · Status (Scheduled / Active / Ended) · ⋮ Edit / End now ·
// ADD DELEGATION (on behalf of an approver: Approver * + the G6 fields) · EXPORT .CSV.
// Reassign pending items card (UXQ-05): From approver * · To approver * · Item types · Reason * · preview count ·
// REASSIGN {n} ITEMS (items whose applicant is the new approver are listed and skipped).
// Panel "Approvers on leave today without a delegate" (auto re-route per BR-LV-61, informational).
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  DELEGATION_SCOPES,
  DELEGATION_SCOPE_LABELS,
  DELEGATION_STATES,
  DELEGATION_STATE_LABELS,
  REASSIGN_ITEM_TYPES,
  REASSIGN_ITEM_TYPE_LABELS,
  TASK_SUBJECT_LABELS,
  type ApproverOnLeaveRow,
  type DelegationListParams,
  type DelegationRow,
  type DelegationScope,
  type ReassignItemType,
  type ReassignPreview,
} from '@/server/contracts/approvals';
import { endDelegation, exportDelegationsCsv, previewReassign, reassignPendingItems, saveDelegation } from '@/server/actions/approvals';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import FormDialog from '../forms/FormDialog';
import { DateInput, FormGrid, MultiSelectInput, SelectInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { MiniTable } from '../employees/ui';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import StatusChip from '../StatusChip';
import { formatDate } from '@/lib/format';
import { optionsFrom } from '../leave/common';
import { ApproverPicker, type PickedPerson } from '../leave/pickers';
import { DELEGATION_FILTERS } from '../leave/filters';

const STATE_CHIP: Record<string, 'Active' | 'Inactive'> = { active: 'Active', scheduled: 'Inactive', ended: 'Inactive' };

export function DelegationDialog({ open, onClose, row, own }: { open: boolean; onClose: () => void; row: DelegationRow | null; own?: boolean }) {
  const r = useActionRunner();
  const [approver, setApprover] = React.useState<PickedPerson | null>(null);
  const [delegate, setDelegate] = React.useState<PickedPerson | null>(null);
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [scope, setScope] = React.useState<DelegationScope | ''>('both');
  React.useEffect(() => {
    if (open) {
      setApprover(row ? { id: row.approver.id, employeeNo: row.approver.employeeNo, name: row.approver.name } : null);
      setDelegate(row ? { id: row.delegate.id, employeeNo: row.delegate.employeeNo, name: row.delegate.name } : null);
      setFrom(row?.validFrom ?? '');
      setTo(row?.validTo ?? '');
      setScope(row?.scope ?? 'both');
      r.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title={row ? 'Edit delegation' : 'Add delegation'}
      onClose={onClose}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={Boolean(delegate || from)}
      submitLabel="Save delegation"
      onSubmit={async () => {
        if (!own && !approver) {
          r.setFieldErrors({ delegatorUserId: 'Choose the approver.' });
          return;
        }
        if (!delegate) {
          r.setFieldErrors({ delegateUserId: 'Choose the delegate.' });
          return;
        }
        const res = await r.run(
          () => saveDelegation({ replaceId: row?.id, delegatorUserId: own ? undefined : approver?.id, delegateUserId: delegate.id, validFrom: from, validTo: to, scope: scope as DelegationScope }),
          { success: 'Delegation saved. The delegate has been notified.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <Stack spacing={2}>
        {!own && <ApproverPicker label="Approver" required value={approver} onChange={setApprover} error={r.fieldErrors.delegatorUserId} helper="The approver whose items are delegated." />}
        <ApproverPicker label="Delegate" required value={delegate} onChange={setDelegate} excludeUserId={approver?.id} error={r.fieldErrors.delegateUserId} helper="Active employee user or Admin. The delegate can't approve their own items — those skip to the next level." />
        <FormGrid>
          <DateInput label="From" required value={from} onChange={setFrom} error={r.fieldErrors.validFrom} />
          <DateInput label="To" required value={to} onChange={setTo} minDate={from || undefined} error={r.fieldErrors.validTo} />
          <SelectInput label="Scope" required value={scope} onChange={(v) => setScope(v as DelegationScope)} options={optionsFrom(DELEGATION_SCOPE_LABELS, DELEGATION_SCOPES)} error={r.fieldErrors.scope} />
        </FormGrid>
        <Typography variant="caption" color="text.secondary">
          During the window, new and pending items at the approver&apos;s levels route to the delegate; the approver can still act.
        </Typography>
      </Stack>
    </FormDialog>
  );
}

function ReassignCard() {
  const r = useActionRunner();
  const [fromP, setFromP] = React.useState<PickedPerson | null>(null);
  const [toP, setToP] = React.useState<PickedPerson | null>(null);
  const [types, setTypes] = React.useState<ReassignItemType[]>(['leave', 'cancellations', 'credits']);
  const [reason, setReason] = React.useState('');
  const [pv, setPv] = React.useState<ReassignPreview | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    if (!fromP) {
      setPv(null);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await previewReassign({ fromUserId: fromP.id, toUserId: toP?.id, itemTypes: types });
        if (alive) setPv(res.ok ? res : null);
      } catch {
        if (alive) setPv(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [fromP, toP, types]);
  const n = pv ? pv.count - pv.skipped.length : 0;
  return (
    <Card id="reassign" sx={{ scrollMarginTop: 80 }}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
          Reassign pending items
        </Typography>
        {r.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {r.error}
          </Alert>
        )}
        <FormGrid>
          <ApproverPicker label="From approver" required value={fromP} onChange={setFromP} error={r.fieldErrors.fromUserId} />
          <ApproverPicker label="To approver" required value={toP} onChange={setToP} excludeUserId={fromP?.id} error={r.fieldErrors.toUserId} helper="Active employee or Admin." />
          <MultiSelectInput label="Item types" required value={types} onChange={(v) => setTypes(v as ReassignItemType[])} options={optionsFrom(REASSIGN_ITEM_TYPE_LABELS, REASSIGN_ITEM_TYPES)} error={r.fieldErrors.itemTypes} helper="Claims arrive with W2-005." />
          <TextInput label="Reason" required value={reason} onChange={setReason} maxLength={500} error={r.fieldErrors.reason} helper="At least 10 characters. Shown in the trail: “Reassigned by HR: …”." />
        </FormGrid>
        {pv && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {pv.count} pending item{pv.count === 1 ? '' : 's'} found{pv.skipped.length ? ` · ${pv.skipped.length} will be skipped` : ''}.
            </Typography>
            <MiniTable
              caption="Items to reassign"
              rows={pv.items}
              getRowId={(x) => x.reference}
              empty="Nothing pending for this approver."
              columns={[
                { key: 'r', header: 'Reference', render: (x) => x.reference },
                { key: 't', header: 'Type', render: (x) => TASK_SUBJECT_LABELS[x.subjectType] },
                { key: 'e', header: 'Employee', render: (x) => x.employeeName },
                { key: 'l', header: 'Level', render: (x) => `L${x.level}` },
              ]}
            />
            {pv.skipped.map((s) => (
              <Typography key={s.reference} variant="body2" color="error">
                ✕ {s.reference} — {s.employeeName}: {s.note}
              </Typography>
            ))}
          </Box>
        )}
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
          <Button variant="contained" disabled={!fromP || !toP || n === 0 || reason.trim().length < 10} onClick={() => setConfirm(true)} loading={r.saving}>
            Reassign {n} item{n === 1 ? '' : 's'}
          </Button>
        </Stack>
      </CardContent>
      <ConfirmDialog
        open={confirm}
        title={`Reassign ${n} items to ${toP?.name ?? ''}?`}
        body={`Pending items of ${fromP?.name ?? ''} move to ${toP?.name ?? ''}; both are notified and the trail records your reason.`}
        confirmLabel={`Reassign ${n} items`}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          if (!fromP || !toP) return;
          const res = await r.run(() => reassignPendingItems({ fromUserId: fromP.id, toUserId: toP.id, itemTypes: types, reason: reason.trim() }), {
            success: (x) => `${(x as unknown as { reassigned: number }).reassigned} items reassigned.`,
          });
          setConfirm(false);
          if (res?.ok) {
            setReason('');
            setPv(null);
            setFromP(null);
            setToP(null);
          }
        }}
      />
    </Card>
  );
}

export default function DelegationsScreen({ rows, total, params, onLeave }: { rows: DelegationRow[]; total: number; params: DelegationListParams; onLeave: ApproverOnLeaveRow[] }) {
  const list = useServerList({ filters: DELEGATION_FILTERS, sort: { key: 'from', direction: 'desc' } });
  const toast = useToast();
  const r = useActionRunner();
  const [form, setForm] = React.useState<{ row: DelegationRow | null } | null>(null);
  const [end, setEnd] = React.useState<DelegationRow | null>(null);
  const d = list.draft;
  const set = list.setDraftField;
  const person = (p: { name: string; employeeNo: string | null }) => `${p.name}${p.employeeNo ? ` (${p.employeeNo})` : ''}`;
  const columns: ListColumn<DelegationRow>[] = [
    { key: 'approver', header: 'Approver', value: (x) => person(x.approver) },
    { key: 'delegate', header: 'Delegate', value: (x) => person(x.delegate) },
    { key: 'from', header: 'From', kind: 'date', value: (x) => formatDate(x.validFrom), render: (x) => <DateText value={x.validFrom} /> },
    { key: 'to', header: 'To', kind: 'date', sortable: false, value: (x) => formatDate(x.validTo), render: (x) => <DateText value={x.validTo} /> },
    { key: 'scope', header: 'Scope', sortable: false, value: (x) => DELEGATION_SCOPE_LABELS[x.scope] },
    { key: 'setBy', header: 'Set by', sortable: false, priority: 'low', value: (x) => (x.setBy === 'self' ? 'Self' : `Admin (${x.setByName})`) },
    {
      key: 'state',
      header: 'Status',
      kind: 'status',
      sortable: false,
      value: (x) => DELEGATION_STATE_LABELS[x.state],
      render: (x) => <StatusChip set="active" value={STATE_CHIP[x.state] ?? 'Inactive'} label={DELEGATION_STATE_LABELS[x.state]} />,
    },
  ];
  return (
    <Stack spacing={2}>
      <ListPage<DelegationRow>
        itemName={{ singular: 'delegation', plural: 'delegations' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Approver or delegate name / employee no." />,
          <ApproverPicker
            key="a"
            label="Approver"
            value={d.approverUserId ? { id: d.approverUserId, employeeNo: null, name: d.approverName || 'Selected approver' } : null}
            onChange={(v) => {
              set('approverUserId', v?.id ?? '');
              set('approverName', v?.name ?? '');
            }}
          />,
          <ApproverPicker
            key="dl"
            label="Delegate"
            value={d.delegateUserId ? { id: d.delegateUserId, employeeNo: null, name: d.delegateName || 'Selected delegate' } : null}
            onChange={(v) => {
              set('delegateUserId', v?.id ?? '');
              set('delegateName', v?.name ?? '');
            }}
          />,
          <DateFilter key="on" label="Active on date" value={d.activeOn} onChange={(v) => set('activeOn', v)} />,
          <MultiSelectFilter key="sc" label="Scope" value={d.scopes} onChange={(v) => set('scopes', v)} options={optionsFrom(DELEGATION_SCOPE_LABELS, DELEGATION_SCOPES)} />,
          <MultiSelectFilter key="st" label="Status" value={d.states} onChange={(v) => set('states', v)} options={optionsFrom(DELEGATION_STATE_LABELS, DELEGATION_STATES)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Add delegation', onClick: () => setForm({ row: null }) }}
        onExport={async () => {
          try {
            const res = await exportDelegationsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'delegations', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowRef={(x) => `${x.approver.name} → ${x.delegate.name}`}
        rowActions={(x) => [
          ...(x.canEdit ? [{ label: 'Edit', onClick: () => setForm({ row: x }) }] : []),
          ...(x.canEnd ? [{ label: 'End now', danger: true, onClick: () => setEnd(x) }] : []),
        ]}
        empty={{ title: 'No delegations yet.' }}
      />
      <ReassignCard />
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
            Approvers on leave today without a delegate
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Their new and pending items re-route automatically to their own manager, or to the Admin pool (BR-LV-61).
          </Typography>
          <MiniTable
            caption="Approvers on leave today"
            rows={onLeave}
            getRowId={(x) => x.approver.id}
            empty="None today."
            columns={[
              { key: 'a', header: 'Approver', render: (x) => person(x.approver) },
              { key: 'u', header: 'On leave until', render: (x) => formatDate(x.leaveUntil) },
              { key: 'o', header: 'Open items', align: 'right', render: (x) => x.openItems },
              { key: 'r', header: 'Re-routed to', render: (x) => x.reroutedTo },
            ]}
          />
        </CardContent>
      </Card>
      <DelegationDialog open={form !== null} row={form?.row ?? null} onClose={() => setForm(null)} />
      <ConfirmDialog
        open={Boolean(end)}
        title="End this delegation now?"
        body={end ? `${end.delegate.name} stops acting for ${end.approver.name} today. Pending items return to ${end.approver.name}.` : ''}
        confirmLabel="End now"
        destructive
        onClose={() => setEnd(null)}
        onConfirm={async () => {
          if (!end) return;
          const res = await r.run(() => endDelegation({ id: end.id }), { success: 'Delegation ended.' });
          if (res && !res.ok) toast.info(res.error);
          setEnd(null);
        }}
      />
    </Stack>
  );
}
