'use client';

// L1 · Leave applications — S-LV-01 · /leave/applications (ADM, SA) · /team/leave (MGR: reportees + items routed)
// F-LV-22, F-LV-09, F-LV-26 · US-LEAVE-029, 015, 034
// Search reference / employee no. / name · Filters Employee · Work location · Department · Leave date from–to · Type ·
// Status (default all except Withdrawn) · Emergency only · On behalf only · More: Applied from–to · Level · MC check
// (ADM/SA) · Include separated employees · Columns [ ] · Reference › · Employee · From · To · Days · Reason · 📎 · Type ·
// Applied · Status (L1/L2) · Approver & date · Flags · 👁 · Bulk APPROVE SELECTED / DECLINE SELECTED (only rows where I
// am the current approver; others reported as skipped) · EXPORT .CSV · APPLY ON BEHALF (ADM, SA) · Sort Applied desc.
import * as React from 'react';
import Button from '@mui/material/Button';
import {
  LEAVE_STATUSES,
  LEAVE_STATUS_LABELS,
  MC_FILTERS,
  MC_STATUS_LABELS,
  type LeaveApplicationListParams,
  type LeaveApplicationRow,
} from '@/server/contracts/leave';
import { exportLeaveApplicationsCsv } from '@/server/actions/leave';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter, YesNoFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import EmployeePicker from '../employees/EmployeePicker';
import { formatDate, formatDateTime } from '@/lib/format';
import { BulkDecisionDialog } from '../approvals/DecisionDialog';
import { LeaveFlags, LeaveStatusChip, TypeLabel, formatDays, leaveStatusText } from './common';
import { LEAVE_APP_FILTERS } from './filters';
import type { LeaveFilterOptions } from '@/app/_lib/leave-options';

const MC_FILTER_LABELS: Record<(typeof MC_FILTERS)[number], string> = { ...MC_STATUS_LABELS, attachment_pending: 'Attachment pending' };

export default function ApplicationsList({
  rows,
  total,
  params,
  options,
  scope,
}: {
  rows: LeaveApplicationRow[];
  total: number;
  params: LeaveApplicationListParams;
  options: LeaveFilterOptions;
  scope: 'all' | 'team';
}) {
  const list = useServerList({ filters: LEAVE_APP_FILTERS, sort: { key: 'applied', direction: 'desc' } });
  const toast = useToast();
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulk, setBulk] = React.useState<'approve' | 'reject' | null>(null);
  React.useEffect(() => setSelected([]), [rows]);
  const d = list.draft;
  const set = list.setDraftField;
  const admin = scope === 'all';
  const href = (r: LeaveApplicationRow) => `/approvals/leave/${encodeURIComponent(r.refNo)}?from=${admin ? 'applications' : 'team'}`;
  const selectableIds = rows.filter((r) => r.myTaskId).map((r) => r.id);

  const columns: ListColumn<LeaveApplicationRow>[] = [
    { key: 'ref', header: 'Reference', sortable: false, value: (r) => r.refNo },
    { key: 'employee', header: 'Employee', value: (r) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}` },
    { key: 'from', header: 'From', kind: 'date', value: (r) => formatDate(r.startDate), render: (r) => <DateText value={r.startDate} /> },
    { key: 'to', header: 'To', kind: 'date', sortable: false, value: (r) => formatDate(r.endDate), render: (r) => <DateText value={r.endDate} /> },
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatDays(r.days) },
    { key: 'reason', header: 'Reason', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.reason ?? '' },
    { key: 'att', header: '📎', sortable: false, align: 'center', priority: 'low', hideOnCard: true, value: (r) => (r.attachmentCount ? String(r.attachmentCount) : '') },
    { key: 'type', header: 'Type', value: (r) => r.leaveType.name, render: (r) => <TypeLabel type={r.leaveType} /> },
    { key: 'applied', header: 'Applied', kind: 'date', priority: 'low', value: (r) => formatDateTime(r.appliedAt), render: (r) => <DateText value={r.appliedAt} mode="datetime" /> },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => leaveStatusText(r.status, r.level), render: (r) => <LeaveStatusChip status={r.status} level={r.level} /> },
    {
      key: 'approver',
      header: 'Approver & date',
      sortable: false,
      priority: 'low',
      value: (r) => [r.approverName, r.approverAt ? formatDateTime(r.approverAt) : null].filter(Boolean).join(' · '),
    },
    {
      key: 'flags',
      header: 'Flags',
      sortable: false,
      hideOnCard: true,
      value: (r) =>
        [r.isEmergency && 'EMERGENCY', r.onBehalf && 'On behalf', r.attachmentPending && 'Attachment pending', r.mcStatus === 'invalid' && 'MC invalid'].filter(Boolean).join(', '),
      render: (r) => <LeaveFlags emergency={r.isEmergency} onBehalf={r.onBehalf} attachmentPending={r.attachmentPending} mcInvalid={r.mcStatus === 'invalid'} />,
    },
  ];

  const filters: React.ReactNode[] = [
    <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Reference, employee no. or name." />,
  ];
  if (admin)
    filters.push(
      <EmployeePicker
        key="e"
        label="Employee"
        activeOnly={false}
        value={d.employeeId ? { id: d.employeeId, employeeNo: '', name: d.employeeName || 'Selected employee' } : null}
        onChange={(v) => {
          set('employeeId', v?.id ?? '');
          set('employeeName', v ? `${v.name}${v.employeeNo ? ` (${v.employeeNo})` : ''}` : '');
        }}
      />,
    );
  filters.push(
    <MultiSelectFilter key="lc" label="Work location" value={d.locationIds} onChange={(v) => set('locationIds', v)} options={options.locations.map((x) => ({ value: x.id, label: x.label }))} />,
    <MultiSelectFilter key="dp" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={options.departments.map((x) => ({ value: x.id, label: x.label }))} />,
    <DateFilter key="f" label="Leave date from" value={d.from} onChange={(v) => set('from', v)} />,
    <DateFilter key="t" label="Leave date to" value={d.to} onChange={(v) => set('to', v)} />,
    <MultiSelectFilter key="ty" label="Type" value={d.leaveTypeIds} onChange={(v) => set('leaveTypeIds', v)} options={options.types.map((t) => ({ value: t.id, label: t.name }))} />,
    <MultiSelectFilter
      key="s"
      label="Status (default: all except Withdrawn)"
      value={d.statuses}
      onChange={(v) => set('statuses', v)}
      options={LEAVE_STATUSES.map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] }))}
    />,
    <YesNoFilter key="em" label="Emergency only" value={d.emergencyOnly} onChange={(v) => set('emergencyOnly', v)} />,
    <YesNoFilter key="ob" label="On behalf only" value={d.onBehalfOnly} onChange={(v) => set('onBehalfOnly', v)} />,
    <DateFilter key="af" label="Applied from" value={d.appliedFrom} onChange={(v) => set('appliedFrom', v)} />,
    <DateFilter key="at" label="Applied to" value={d.appliedTo} onChange={(v) => set('appliedTo', v)} />,
    <SelectFilter
      key="lv"
      label="Level"
      value={d.level}
      onChange={(v) => set('level', v)}
      options={[
        { value: '1', label: 'L1' },
        { value: '2', label: 'L2' },
        { value: '3', label: 'L3' },
      ]}
    />,
  );
  if (admin)
    filters.push(
      <MultiSelectFilter key="mc" label="MC check" value={d.mcFilters} onChange={(v) => set('mcFilters', v)} options={MC_FILTERS.map((m) => ({ value: m, label: MC_FILTER_LABELS[m] }))} />,
    );
  filters.push(<YesNoFilter key="sep" label="Include separated employees (default per policy)" value={d.includeSeparated} onChange={(v) => set('includeSeparated', v)} />);

  return (
    <>
      <ListPage<LeaveApplicationRow>
        itemName={{ singular: 'leave application', plural: 'leave applications' }}
        filters={filters}
        {...list.listProps}
        addNew={admin ? { label: 'Apply on behalf', href: '/leave/apply-on-behalf' } : undefined}
        onExport={async () => {
          try {
            const res = await exportLeaveApplicationsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'leave-applications', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.id}
        getRowHref={href}
        getRowRef={(r) => r.refNo}
        selectable
        selected={selected}
        onSelectedChange={(ids) => setSelected(ids.filter((id) => selectableIds.includes(id)))}
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
        empty={{ title: 'No leave applications match these filters.' }}
      />
      <BulkDecisionDialog
        open={bulk !== null}
        decision={bulk ?? 'approve'}
        items={rows.filter((r) => selected.includes(r.id) && r.myTaskId).map((r) => ({ taskId: r.myTaskId!, reference: r.refNo }))}
        itemLabel="leave applications"
        onClose={() => setBulk(null)}
        onDone={() => setSelected([])}
      />
    </>
  );
}

