'use client';

// P26 · Approvals inbox — S-AP-01 · /approvals · F-PRT-11, F-LV-09/10/15 · US-PORTAL-011, US-LEAVE-014/015
// Generic inbox over the approval engine: tabs Leave · Cancellations · Replacement credits (W2-004) and (W2-005)
// Claims (Submitted; bulk APPROVE / REJECT SELECTED, DOWNLOAD ATTACHMENTS for ADM/SA; own claims read-only "Your claim") ·
// Approved claims – not disbursed (row CANCEL, reason mandatory — BR-CLM-26) · Batches & runs (SA; batches Pending approval).
// Tab badges = actionable counts. Filters: search ref/employee · Department · Location · Type · From · To ·
// Emergency only · "Only items pending my approval" (ADM/SA may turn off for override). Row APPROVE / REJECT
// (P30 dialog); bulk APPROVE SELECTED / DECLINE SELECTED on the Leave tab (desktop only — FR-PRT-07).
// Phone: tabs as a scrollable chip row, rows as cards (ListPage), no bulk.
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import {
  INBOX_TAB_LABELS,
  type InboxCancellationRow,
  type InboxCounts,
  type InboxApprovedClaimRow,
  type InboxBatchRow,
  type InboxClaimRow,
  type InboxCreditRow,
  type InboxLeaveRow,
  type InboxPage,
  type InboxParams,
  type InboxTab,
} from '@/server/contracts/approvals';
import { CREDIT_DURATION_LABELS } from '@/server/contracts/leave';
import { exportInboxCsv } from '@/server/actions/approvals';
import { cancelClaim } from '@/server/actions/claims';
import ReasonDialog from '../dialogs/ReasonDialog';
import { CLAIM_FLAG_OPTIONS, ClaimFlags, MoneyCell, flagsText, monthText } from '../claims/common';
import { AttachmentBundleDialog } from '../claims/AdminDialogs';
import StatusChip from '../StatusChip';
import { formatAmount, formatMoney } from '@/lib/format';
import TextField from '@mui/material/TextField';
import ListPage, { type ListColumn, type RowAction } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { TabPlaceholder } from '../employees/ui';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import { formatDate, formatDateTime } from '@/lib/format';
import { EmergencyChip, TypeLabel, formatDays } from '../leave/common';
import { INBOX_FILTERS } from '../leave/filters';
import { BulkDecisionDialog, DecisionDialog, type DecisionKind, type DecisionSubject } from './DecisionDialog';
import type { LeaveFilterOptions } from '@/app/_lib/leave-options';

type AnyRow = InboxLeaveRow | InboxCancellationRow | InboxCreditRow;
const empText = (r: { employee: { name: string; employeeNo: string | null } }) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}`;

export default function ApprovalsInbox({
  tab,
  tabs,
  counts,
  page,
  params,
  options,
  isAdmin,
}: {
  tab: InboxTab;
  tabs: InboxTab[];
  counts: InboxCounts;
  page: InboxPage;
  params: InboxParams;
  options: LeaveFilterOptions & { claimCategories?: { id: string; label: string }[] };
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname() ?? '/approvals';
  const sp = useSearchParams();
  const toast = useToast();
  const list = useServerList({ filters: INBOX_FILTERS, sort: { key: 'applied', direction: 'asc' }, preserve: ['tab'] });
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulk, setBulk] = React.useState<'approve' | 'reject' | null>(null);
  const [one, setOne] = React.useState<{ kind: DecisionKind; subject: DecisionSubject; reference: string; taskId: string; version: number } | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<InboxApprovedClaimRow | null>(null);
  const [zip, setZip] = React.useState(false);
  const claimTab = tab === 'claims' || tab === 'claims_approved';
  const d = list.draft;
  const set = list.setDraftField;
  React.useEffect(() => setSelected([]), [tab, page]);

  const goTab = (t: InboxTab) => {
    const next = new URLSearchParams();
    next.set('tab', t);
    for (const k of Object.keys(INBOX_FILTERS)) {
      const v = sp?.get(k);
      if (v !== null && v !== undefined) next.set(k, v);
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const decide = (r: AnyRow, approve: boolean, subject: DecisionSubject, reference: string): RowAction => ({
    label: approve ? (r.overrideOnly ? 'Approve as Admin (override)' : subject === 'cancellation' ? 'Approve cancellation' : 'Approve') : r.overrideOnly ? 'Reject as Admin (override)' : subject === 'cancellation' ? 'Reject cancellation' : 'Reject',
    danger: !approve,
    onClick: () => setOne({ kind: r.overrideOnly ? (approve ? 'override_approve' : 'override_reject') : approve ? 'approve' : 'reject', subject, reference, taskId: r.taskId, version: r.taskVersion }),
  });
  const rowActions = (subject: DecisionSubject, ref: (r: AnyRow) => string) => (r: AnyRow) => (r.canDecide ? [decide(r, true, subject, ref(r)), decide(r, false, subject, ref(r))] : []);

  const employeeCol = <R extends AnyRow>(): ListColumn<R> => ({
    key: 'employee',
    header: 'Employee',
    value: (r) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}`,
  });
  const waitingCol = <R extends AnyRow>(): ListColumn<R> => ({
    key: 'waiting',
    header: 'Waiting',
    align: 'right',
    value: (r) => `${r.waitingWorkingDays} d`,
  });

  const leaveCols: ListColumn<InboxLeaveRow>[] = [
    { key: 'ref', header: 'Reference', sortable: false, value: (r) => r.refNo },
    employeeCol<InboxLeaveRow>(),
    { key: 'department', header: 'Department', sortable: false, priority: 'low', value: (r) => r.department },
    { key: 'type', header: 'Type', sortable: false, value: (r) => r.leaveType.name, render: (r) => <TypeLabel type={r.leaveType} /> },
    { key: 'from', header: 'From', kind: 'date', value: (r) => formatDate(r.startDate), render: (r) => <DateText value={r.startDate} /> },
    { key: 'to', header: 'To', kind: 'date', sortable: false, value: (r) => formatDate(r.endDate), render: (r) => <DateText value={r.endDate} /> },
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatDays(r.days) },
    { key: 'reason', header: 'Reason', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.reason ?? '' },
    { key: 'att', header: '📎', sortable: false, priority: 'low', hideOnCard: true, align: 'center', value: (r) => (r.attachmentCount ? String(r.attachmentCount) : '') },
    { key: 'emergency', header: 'Emergency', sortable: false, kind: 'status', value: (r) => (r.isEmergency ? 'EMERGENCY' : ''), render: (r) => (r.isEmergency ? <EmergencyChip /> : '—') },
    { key: 'applied', header: 'Applied', kind: 'date', priority: 'low', value: (r) => formatDateTime(r.appliedAt), render: (r) => <DateText value={r.appliedAt} mode="datetime" /> },
    { key: 'level', header: 'Level', sortable: false, value: (r) => `L${r.level}${r.levels > 1 ? ` of ${r.levels}` : ''}${r.overrideOnly ? ' · override' : ''}` },
    waitingCol<InboxLeaveRow>(),
  ];
  const cancelCols: ListColumn<InboxCancellationRow>[] = [
    { key: 'ref', header: 'Reference', sortable: false, value: (r) => r.refNo },
    employeeCol<InboxCancellationRow>(),
    { key: 'type', header: 'Type', sortable: false, value: (r) => r.leaveType.name, render: (r) => <TypeLabel type={r.leaveType} /> },
    { key: 'from', header: 'From', kind: 'date', value: (r) => formatDate(r.startDate), render: (r) => <DateText value={r.startDate} /> },
    { key: 'to', header: 'To', kind: 'date', sortable: false, value: (r) => formatDate(r.endDate), render: (r) => <DateText value={r.endDate} /> },
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatDays(r.days) },
    { key: 'applied', header: 'Requested at', kind: 'date', value: (r) => formatDateTime(r.requestedAt), render: (r) => <DateText value={r.requestedAt} mode="datetime" /> },
    { key: 'reason', header: 'Reason', sortable: false, priority: 'low', value: (r) => r.reason ?? '' },
    waitingCol<InboxCancellationRow>(),
  ];
  const creditCols: ListColumn<InboxCreditRow>[] = [
    { key: 'ref', header: 'Credit no.', sortable: false, value: (r) => r.creditNo },
    employeeCol<InboxCreditRow>(),
    { key: 'from', header: 'Date worked', kind: 'date', value: (r) => formatDate(r.dateWorked), render: (r) => <DateText value={r.dateWorked} /> },
    { key: 'dayType', header: 'Day type', sortable: false, value: (r) => r.dayTypeLabel },
    { key: 'duration', header: 'Duration', sortable: false, priority: 'low', value: (r) => CREDIT_DURATION_LABELS[r.duration] },
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatDays(r.days) },
    { key: 'reason', header: 'Reason', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.reason },
    { key: 'applied', header: 'Submitted', kind: 'date', priority: 'low', value: (r) => formatDateTime(r.submittedAt), render: (r) => <DateText value={r.submittedAt} mode="datetime" /> },
    waitingCol<InboxCreditRow>(),
  ];

  const claimCols: ListColumn<InboxClaimRow>[] = [
    { key: 'ref', header: 'Claim no.', sortable: false, value: (r) => r.claimNo },
    {
      key: 'employee',
      header: 'Employee',
      value: empText,
      render: (r) => (
        <span>
          {empText(r)} {r.isOwn && <StatusChip set="claim" value="New" label="Your claim" size="xsmall" />}
        </span>
      ),
    },
    { key: 'department', header: 'Department', sortable: false, priority: 'low', value: (r) => r.department },
    { key: 'title', header: 'Title', sortable: false, value: (r) => r.title },
    { key: 'lines', header: 'Lines', align: 'right', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.lineCount },
    { key: 'total', header: 'Total (RM)', kind: 'money', sortable: false, value: (r) => formatAmount(r.total), render: (r) => <MoneyCell v={r.total} /> },
    { key: 'sst', header: 'SST (RM)', kind: 'money', sortable: false, priority: 'low', hideOnCard: true, value: (r) => formatAmount(r.totalSst), render: (r) => <MoneyCell v={r.totalSst} /> },
    { key: 'att', header: '📎', sortable: false, align: 'center', priority: 'low', hideOnCard: true, value: (r) => (r.attachmentCount ? r.attachmentCount : '') },
    { key: 'flags', header: 'Flags', sortable: false, kind: 'status', value: (r) => flagsText(r.flags), render: (r) => <ClaimFlags flags={r.flags} /> },
    { key: 'applied', header: 'Submitted', kind: 'date', value: (r) => formatDateTime(r.submittedAt), render: (r) => <DateText value={r.submittedAt} mode="datetime" /> },
    { key: 'waiting', header: 'Waiting', align: 'right', value: (r) => `${r.waitingWorkingDays} d` },
  ];
  const approvedCols: ListColumn<InboxApprovedClaimRow>[] = [
    { key: 'ref', header: 'Claim no.', sortable: false, value: (r) => r.claimNo },
    { key: 'employee', header: 'Employee', value: empText },
    { key: 'title', header: 'Title', sortable: false, value: (r) => r.title },
    { key: 'total', header: 'Total (RM)', kind: 'money', sortable: false, value: (r) => formatAmount(r.total), render: (r) => <MoneyCell v={r.total} /> },
    { key: 'applied', header: 'Approved on', kind: 'date', value: (r) => formatDate(r.approvedAt), render: (r) => <DateText value={r.approvedAt} /> },
    { key: 'by', header: 'Approved by', sortable: false, priority: 'low', value: (r) => r.approvedByName ?? '' },
    ...(isAdmin ? ([{ key: 'batch', header: 'Batch / payroll run', sortable: false, priority: 'low', value: (r: InboxApprovedClaimRow) => r.batchNo ?? '' }] as ListColumn<InboxApprovedClaimRow>[]) : []),
    { key: 'waiting', header: 'Age (days)', align: 'right', value: (r) => r.ageDays },
  ];
  const batchCols: ListColumn<InboxBatchRow>[] = [
    { key: 'ref', header: 'Ref', sortable: false, value: (r) => r.batchNo },
    { key: 'type', header: 'Type', sortable: false, value: () => 'Disbursement batch' },
    { key: 'period', header: 'Period', sortable: false, value: (r) => monthText(r.period) },
    { key: 'count', header: 'Count', align: 'right', sortable: false, value: (r) => r.count },
    { key: 'total', header: 'Total (RM)', kind: 'money', sortable: false, value: (r) => formatAmount(r.total), render: (r) => <MoneyCell v={r.total} /> },
    { key: 'employee', header: 'Prepared by', sortable: false, value: (r) => r.preparedByName },
    { key: 'applied', header: 'Submitted at', kind: 'date', value: (r) => formatDateTime(r.submittedAt), render: (r) => <DateText value={r.submittedAt} mode="datetime" /> },
  ];

  const typeOpts = options.types.map((t) => ({ value: t.id, label: t.name }));
  const depOpts = options.departments.map((x) => ({ value: x.id, label: x.label }));
  const locOpts = options.locations.map((x) => ({ value: x.id, label: x.label }));
  const filters: React.ReactNode[] = [
    <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Reference, employee no. or name." />,
    <MultiSelectFilter key="dp" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={depOpts} />,
  ];
  if (tab === 'leave') filters.push(<MultiSelectFilter key="lc" label="Location" value={d.locationIds} onChange={(v) => set('locationIds', v)} options={locOpts} />);
  if (tab === 'leave' || tab === 'cancellations') filters.push(<MultiSelectFilter key="t" label="Type" value={d.leaveTypeIds} onChange={(v) => set('leaveTypeIds', v)} options={typeOpts} />);
  if (tab === 'claims') {
    filters.push(
      <MultiSelectFilter key="cc" label="Category" value={d.categoryIds} onChange={(v) => set('categoryIds', v)} options={(options.claimCategories ?? []).map((x) => ({ value: x.id, label: x.label }))} />,
      <TextField key="af" label="Amount from (RM)" value={d.amountFrom} onChange={(e) => set('amountFrom', e.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />,
      <TextField key="at" label="Amount to (RM)" value={d.amountTo} onChange={(e) => set('amountTo', e.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }} />,
      <MultiSelectFilter key="fl" label="Flags" value={d.flags} onChange={(v) => set('flags', v)} options={CLAIM_FLAG_OPTIONS} />,
    );
  }
  if (tab === 'claims_approved')
    filters.push(
      <SelectFilter key="ib" label="In batch" value={d.inBatch} onChange={(v) => set('inBatch', v)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />,
    );
  if (tab !== 'batches')
    filters.push(
      <DateFilter key="f" label={tab === 'claims' ? 'Submitted from' : tab === 'claims_approved' ? 'Approved from' : 'From'} value={d.from} onChange={(v) => set('from', v)} />,
      <DateFilter key="to" label={tab === 'claims' ? 'Submitted to' : tab === 'claims_approved' ? 'Approved to' : 'To'} value={d.to} onChange={(v) => set('to', v)} />,
    );
  if (tab === 'leave')
    filters.push(
      <SelectFilter key="em" label="Emergency only" value={d.emergencyOnly} onChange={(v) => set('emergencyOnly', v)} options={[{ value: 'yes', label: 'Yes' }]} />,
    );
  if (tab === 'claims' && !isAdmin)
    filters.push(
      <SelectFilter
        key="mine"
        label="Only my reportees"
        value={d.onlyMine}
        onChange={(v) => set('onlyMine', v || 'no')}
        options={[
          { value: 'yes', label: 'Yes (default)' },
          { value: 'no', label: 'No — include items delegated to me' },
        ]}
      />,
    );
  if (isAdmin && tab !== 'claims_approved' && tab !== 'batches')
    filters.push(
      <SelectFilter
        key="mine"
        label="Only items pending my approval"
        value={d.onlyMine}
        onChange={(v) => set('onlyMine', v || 'no')}
        options={[
          { value: 'yes', label: 'Yes (default)' },
          { value: 'no', label: 'No — show all pending (override)' },
        ]}
      />,
    );

  const exportFn = async () => {
    try {
      const res = await exportInboxCsv(params);
      if (res.ok) downloadServerCsv(res.filename || `approvals-${tab}`, res.content);
      else toast.info(res.error);
    } catch {
      toast.info('Export failed. Please try again.');
    }
  };

  const common = {
    itemName: { singular: 'item', plural: 'items' },
    filters,
    ...list.listProps,
    onExport: exportFn,
    total: page.total,
    empty: { title: 'Nothing waiting for you.' },
  };

  let body: React.ReactNode;
  if (tab === 'leave' && page.tab === 'leave') {
    const selectable = page.rows.filter((r) => r.canDecide && !r.overrideOnly).map((r) => r.taskId);
    body = (
      <ListPage<InboxLeaveRow>
        {...common}
        columns={leaveCols}
        rows={page.rows}
        getRowId={(r) => r.taskId}
        getRowHref={(r) => `/approvals/leave/${encodeURIComponent(r.refNo)}`}
        getRowRef={(r) => r.refNo}
        rowActions={rowActions('leave', (r) => (r as InboxLeaveRow).refNo)}
        selectable
        selected={selected}
        onSelectedChange={(ids) => setSelected(ids.filter((id) => selectable.includes(id)))}
        bulkActions={
          <>
            <Button size="small" variant="contained" onClick={() => setBulk('approve')}>
              Approve selected
            </Button>
            <Button size="small" variant="outlined" color="error" onClick={() => setBulk('reject')}>
              Decline selected
            </Button>
          </>
        }
      />
    );
  } else if (tab === 'cancellations' && page.tab === 'cancellations') {
    body = (
      <ListPage<InboxCancellationRow>
        {...common}
        columns={cancelCols}
        rows={page.rows}
        getRowId={(r) => r.taskId}
        getRowHref={(r) => `/approvals/leave/${encodeURIComponent(r.refNo)}`}
        getRowRef={(r) => r.refNo}
        rowActions={rowActions('cancellation', (r) => (r as InboxCancellationRow).refNo)}
      />
    );
  } else if (tab === 'credits' && page.tab === 'credits') {
    body = (
      <ListPage<InboxCreditRow>
        {...common}
        columns={creditCols}
        rows={page.rows}
        getRowId={(r) => r.taskId}
        getRowHref={(r) => `/approvals/credits/${encodeURIComponent(r.creditNo)}`}
        getRowRef={(r) => r.creditNo}
        rowActions={rowActions('credit', (r) => (r as InboxCreditRow).creditNo)}
      />
    );
  } else if (tab === 'claims' && page.tab === 'claims') {
    const selectable = page.rows.filter((r) => r.canDecide && !r.isOwn).map((r) => r.taskId);
    body = (
      <ListPage<InboxClaimRow>
        {...common}
        columns={claimCols}
        rows={page.rows}
        getRowId={(r) => r.taskId}
        getRowHref={(r) => `/approvals/claims/${encodeURIComponent(r.claimNo)}`}
        getRowRef={(r) => r.claimNo}
        rowActions={(r) =>
          r.canDecide && !r.isOwn
            ? [
                { label: 'Approve', onClick: () => setOne({ kind: 'approve', subject: 'claim', reference: r.claimNo, taskId: r.taskId, version: r.taskVersion }) },
                { label: 'Reject', danger: true, onClick: () => setOne({ kind: 'reject', subject: 'claim', reference: r.claimNo, taskId: r.taskId, version: r.taskVersion }) },
              ]
            : []
        }
        extraActions={
          isAdmin ? (
            <Button variant="outlined" onClick={() => setZip(true)} disabled={page.rows.length === 0}>
              Download attachments
            </Button>
          ) : undefined
        }
        selectable
        selected={selected}
        onSelectedChange={(ids) => setSelected(ids.filter((id) => selectable.includes(id)))}
        bulkActions={
          <>
            <Button size="small" variant="contained" onClick={() => setBulk('approve')}>
              Approve selected
            </Button>
            <Button size="small" variant="outlined" color="error" onClick={() => setBulk('reject')}>
              Reject selected
            </Button>
          </>
        }
      />
    );
  } else if (tab === 'claims_approved' && page.tab === 'claims_approved') {
    body = (
      <ListPage<InboxApprovedClaimRow>
        {...common}
        empty={{ title: 'No approved claims waiting for disbursement.' }}
        columns={approvedCols}
        rows={page.rows}
        getRowId={(r) => r.claimId}
        getRowHref={(r) => `/approvals/claims/${encodeURIComponent(r.claimNo)}`}
        getRowRef={(r) => r.claimNo}
        rowActions={(r) => (r.canCancel ? [{ label: 'Cancel', danger: true, onClick: () => setCancelTarget(r) }] : [])}
      />
    );
  } else if (tab === 'batches' && page.tab === 'batches') {
    body = (
      <ListPage<InboxBatchRow>
        {...common}
        columns={batchCols}
        rows={page.rows}
        getRowId={(r) => r.taskId}
        getRowHref={(r) => `/claims/batches/${encodeURIComponent(r.batchNo)}`}
        getRowRef={(r) => r.batchNo}
        empty={{ title: page.placeholder || 'Nothing waiting for you.' }}
      />
    );
  } else {
    body = (
      <TabPlaceholder title={INBOX_TAB_LABELS[tab]} body={page.placeholder || 'Nothing waiting for you.'} />
    );
  }

  const leaveRows = page.tab === 'leave' ? page.rows : [];
  const claimRows = page.tab === 'claims' ? page.rows : [];
  const bulkItems = tab === 'claims' ? claimRows.filter((r) => selected.includes(r.taskId)).map((r) => ({ taskId: r.taskId, reference: r.claimNo })) : leaveRows.filter((r) => selected.includes(r.taskId)).map((r) => ({ taskId: r.taskId, reference: r.refNo }));
  return (
    <Box>
      <Tabs value={tab} onChange={(_e, v) => goTab(v as InboxTab)} variant="scrollable" allowScrollButtonsMobile aria-label="Approval types" sx={{ mb: 2, minHeight: 44 }}>
        {tabs.map((t) => (
          <Tab
            key={t}
            value={t}
            sx={{ minHeight: 44 }}
            label={
              <Badge badgeContent={counts[t]} color="primary" max={99} sx={{ '& .MuiBadge-badge': { right: -12 } }}>
                <span>{INBOX_TAB_LABELS[t]}</span>
              </Badge>
            }
          />
        ))}
      </Tabs>
      {isAdmin && list.applied.filters.onlyMine === 'no' && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Showing every pending item. Items not at your level can only be decided as Admin override (reason required).
        </Typography>
      )}
      {body}
      {one && (
        <DecisionDialog open kind={one.kind} subject={one.subject} reference={one.reference} taskId={one.taskId} taskVersion={one.version} onClose={() => setOne(null)} />
      )}
      <BulkDecisionDialog
        open={bulk !== null}
        decision={bulk ?? 'approve'}
        items={bulkItems}
        itemLabel={tab === 'claims' ? 'claims' : 'leave applications'}
        rejectWord={tab === 'claims' ? 'Reject' : 'Decline'}
        onClose={() => setBulk(null)}
        onDone={() => setSelected([])}
      />
      <ReasonDialog
        open={Boolean(cancelTarget)}
        title={`Cancel ${cancelTarget?.claimNo ?? ''}?`}
        confirmLabel="Cancel claim"
        intro={cancelTarget ? `${cancelTarget.employee.name} is notified with your reason. ${formatMoney(cancelTarget.total)} will not be paid and the claim leaves any open batch.` : undefined}
        onClose={() => setCancelTarget(null)}
        onConfirm={async (reason) => {
          if (!cancelTarget) return;
          if (reason.length < 5) return toast.info('Reason must be at least 5 characters.');
          const res = await cancelClaim({ claimId: cancelTarget.claimId, reason });
          if (res.ok) {
            toast.success(`${cancelTarget.claimNo} cancelled.`);
            setCancelTarget(null);
            router.refresh();
          } else toast.info(res.error);
        }}
      />
      {isAdmin && claimTab && (
        <AttachmentBundleDialog
          open={zip}
          onClose={() => setZip(false)}
          input={{ scope: 'filter', claimIds: (selected.length ? claimRows.filter((r) => selected.includes(r.taskId)) : claimRows).map((r) => r.claimId) }}
          scopeLabel={selected.length ? `${selected.length} selected claims` : 'Claims on this page'}
        />
      )}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        Decisions are recorded with your name and time. You can&apos;t decide your own items, also not as a delegate.
      </Typography>
    </Box>
  );
}
