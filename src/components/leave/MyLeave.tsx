'use client';

// P3 · My leave applications — S-PT-03 · /my/leave · F-PRT-06, F-LV-08, F-LV-10 · US-PORTAL-007
// Tabs above the list: Applications · Balances (→ S-PT-05) · Credits (→ S-PT-09).
// Search reference · Filters Leave year (default current) · Type (multi) · Status (multi) · Date from–to ·
// Columns Reference › · Type · From · To · Days · Status (Pending L1/L2) · Emergency · Submitted · Decided by / at · ⋮
// Row actions: Pending → WITHDRAW · Approved & future & LT30 → CANCEL LEAVE · Approved & started → REQUEST CANCELLATION.
// APPLY LEAVE · EXPORT .CSV · CLEAR · SEARCH. Default sort From desc, 25 rows.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import Button from '@mui/material/Button';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import {
  LEAVE_STATUSES,
  LEAVE_STATUS_LABELS,
  type LeaveTypeRef,
  type MyLeaveParams,
  type MyLeaveRow,
} from '@/server/contracts/leave';
import { exportMyLeaveCsv } from '@/server/actions/leave';
import ListPage, { type ListColumn, type RowAction } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import { formatDate, formatDateTime } from '@/lib/format';
import { EmergencyChip, LeaveStatusChip, TypeLabel, formatDays, leaveStatusText, yearOptions } from './common';
import OwnLeaveDialogs, { type OwnLeaveTarget } from './OwnLeaveDialogs';
import { MY_LEAVE_FILTERS } from './filters';

/** Tabs Applications · Balances · Credits (P3/P5/P9). */
export function MyLeaveTabs() {
  const pathname = usePathname() ?? '';
  const value = pathname.startsWith('/my/leave/balances') ? 'balances' : pathname.startsWith('/my/leave/credits') ? 'credits' : 'applications';
  return (
    <Tabs value={value} variant="scrollable" allowScrollButtonsMobile aria-label="My leave sections" sx={{ mb: 2, minHeight: 44 }}>
      <Tab value="applications" label="Applications" component={NextLink} href="/my/leave" sx={{ minHeight: 44 }} />
      <Tab value="balances" label="Balances" component={NextLink} href="/my/leave/balances" sx={{ minHeight: 44 }} />
      <Tab value="credits" label="Credits" component={NextLink} href="/my/leave/credits" sx={{ minHeight: 44 }} />
    </Tabs>
  );
}

export function myLeaveActions(r: MyLeaveRow, open: (t: OwnLeaveTarget) => void): RowAction[] {
  const base = { applicationId: r.id, refNo: r.refNo, days: r.days };
  const a: RowAction[] = [];
  if (r.can.withdraw) a.push({ label: 'Withdraw', danger: true, onClick: () => open({ kind: 'withdraw', ...base }) });
  if (r.can.cancel) a.push({ label: 'Cancel leave', danger: true, onClick: () => open({ kind: 'cancel', ...base }) });
  if (r.can.requestCancellation) a.push({ label: 'Request cancellation', onClick: () => open({ kind: 'request', ...base }) });
  return a;
}

export function MyLeaveList({
  rows,
  total,
  params,
  types,
  currentYear,
}: {
  rows: MyLeaveRow[];
  total: number;
  params: MyLeaveParams;
  types: LeaveTypeRef[];
  currentYear: number;
}) {
  const defaults = { ...MY_LEAVE_FILTERS, year: String(currentYear) };
  const list = useServerList({ filters: defaults, sort: { key: 'from', direction: 'desc' } });
  const toast = useToast();
  const [target, setTarget] = React.useState<OwnLeaveTarget | null>(null);
  const d = list.draft;
  const set = list.setDraftField;
  const href = (r: MyLeaveRow) => `/my/leave/${encodeURIComponent(r.refNo)}`;

  const columns: ListColumn<MyLeaveRow>[] = [
    { key: 'refNo', header: 'Reference', sortable: false, value: (r) => r.refNo },
    { key: 'type', header: 'Type', value: (r) => r.leaveType.name, render: (r) => <TypeLabel type={r.leaveType} /> },
    { key: 'from', header: 'From', kind: 'date', value: (r) => formatDate(r.startDate), render: (r) => <DateText value={r.startDate} /> },
    { key: 'to', header: 'To', kind: 'date', sortable: false, value: (r) => formatDate(r.endDate), render: (r) => <DateText value={r.endDate} /> },
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatDays(r.days) },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => leaveStatusText(r.status, r.level), render: (r) => <LeaveStatusChip status={r.status} level={r.level} /> },
    { key: 'emergency', header: 'Emergency', sortable: false, priority: 'low', value: (r) => (r.isEmergency ? 'EMERGENCY' : ''), render: (r) => (r.isEmergency ? <EmergencyChip /> : '—') },
    { key: 'submitted', header: 'Submitted', kind: 'date', value: (r) => formatDateTime(r.submittedAt), render: (r) => <DateText value={r.submittedAt} mode="datetime" /> },
    {
      key: 'decided',
      header: 'Decided by / at',
      sortable: false,
      priority: 'low',
      value: (r) => (r.decidedAt ? `${r.decidedByName ?? ''} · ${formatDateTime(r.decidedAt)}` : ''),
    },
  ];

  return (
    <>
      <MyLeaveTabs />
      <ListPage<MyLeaveRow>
        itemName={{ singular: 'leave application', plural: 'leave applications' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} label="Search" hint="Reference no." />,
          <SelectFilter key="y" label="Leave year" value={d.year} onChange={(v) => set('year', v)} options={yearOptions(currentYear, 3, 1)} />,
          <MultiSelectFilter key="t" label="Type" value={d.leaveTypeIds} onChange={(v) => set('leaveTypeIds', v)} options={types.map((t) => ({ value: t.id, label: t.name }))} />,
          <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={LEAVE_STATUSES.map((s) => ({ value: s, label: LEAVE_STATUS_LABELS[s] }))} />,
          <DateFilter key="f" label="Date from" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="to" label="Date to" value={d.to} onChange={(v) => set('to', v)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'Apply leave', href: '/my/leave/apply' }}
        onExport={async () => {
          try {
            const res = await exportMyLeaveCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'my-leave', res.content);
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
        rowActions={(r) => myLeaveActions(r, setTarget)}
        empty={{
          title: `You haven't applied for leave in ${list.applied.filters.year || currentYear}.`,
          action: (
            <Button variant="contained" component={NextLink} href="/my/leave/apply">
              Apply leave
            </Button>
          ),
        }}
      />
      <OwnLeaveDialogs target={target} onClose={() => setTarget(null)} />
    </>
  );
}
