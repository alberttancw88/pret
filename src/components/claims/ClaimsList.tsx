'use client';

// C1 · Claims — S-CL-01 · /claims (ADM/SA) · /team/claims (MGR, reportees + routed, no batch data) · F-CLM-12, F-CLM-25
// KPI strip for the current filter (Submitted · Approved (not disbursed) · Disbursed · Rejected · Total excl. SST · SST · Total) ·
// Search claim no./employee/receipt no./UUID · Employee (ADM/SA) · Department · Category · Status (New only for on-behalf) ·
// Transaction from–to · More filters ▸ Submitted from–to · Approval from–to · Disbursement from–to · Batch · Flags ·
// On behalf only · Include separated · View (•)Header ( )Line.
// Header view: [ ] · Claim no. › · Employee · Department · Title · Lines · Total · SST · Status · Flags · Submitted ·
//   Approved/rejected by & date · Batch · Disbursed on · Payment ref · 👁. Bulk APPROVE / REJECT SELECTED (Submitted, not own).
// Line view (as Kakitangan): Employee · Date of transaction · Date of application · Category · More info · Amount · SST · 📎 ·
//   Receipt/e-Invoice no. · UUID · Date of approval/rejection · Approved/rejected by · Status · Batch · Disbursed on.
// Buttons: EXPORT .CSV · EXPORT .XLSX · AUTOCOUNT EXPORT · DOWNLOAD ATTACHMENTS · SUMMARY REPORT (W2-007) · SUBMIT ON BEHALF.
// MGR: no AutoCount / attachments / summary / on behalf; decisions only in S-AP-04 or in bulk from the inbox.
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import type { ClaimLineListRow, ClaimListPage, ClaimListParams, ClaimListRow } from '@/server/contracts/claims';
import { exportClaimsCsv, exportClaimsXlsx } from '@/server/actions/claims';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import MoneyText from '../MoneyText';
import KpiTile from '../dashboard/KpiTile';
import { formatAmount, formatDate, formatDateTime } from '@/lib/format';
import { BulkDecisionDialog } from '../approvals/DecisionDialog';
import { CLAIM_FLAG_OPTIONS, CLAIM_STATUS_OPTIONS, ClaimEmployeePicker, ClaimFlags, ClaimStatusChip, MoneyCell, claimStatusText, flagsText, openDownload } from './common';
import { AttachmentBundleDialog, AutocountDialog } from './AdminDialogs';
import { CLAIM_LIST_FILTERS } from './filters';

export type ClaimListOptions = {
  departments: { id: string; label: string }[];
  categories: { id: string; label: string }[];
  batches: { id: string; batchNo: string }[];
};

export default function ClaimsList({ page, params, options, scope }: { page: ClaimListPage; params: ClaimListParams; options: ClaimListOptions; scope: 'admin' | 'team' }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/claims';
  const sp = useSearchParams();
  const toast = useToast();
  const admin = scope === 'admin';
  const list = useServerList({ filters: CLAIM_LIST_FILTERS, sort: { key: 'submitted', direction: 'desc' } });
  const d = list.draft;
  const set = list.setDraftField;
  const [more, setMore] = React.useState(Boolean(d.submittedFrom || d.submittedTo || d.decidedFrom || d.decidedTo || d.disbursedFrom || d.disbursedTo || d.batchNo || d.flags || d.onBehalfOnly || d.includeSeparated));
  const [selected, setSelected] = React.useState<string[]>([]);
  const [bulk, setBulk] = React.useState<'approve' | 'reject' | null>(null);
  const [dlg, setDlg] = React.useState<'autocount' | 'zip' | null>(null);
  React.useEffect(() => setSelected([]), [page]);
  const from = admin ? 'claims' : 'team';
  const href = (no: string) => `/approvals/claims/${encodeURIComponent(no)}?from=${from}`;

  const switchView = (view: 'header' | 'line') => {
    const next = new URLSearchParams(sp?.toString() ?? '');
    if (view === 'header') next.delete('view');
    else next.set('view', view);
    for (const k of ['page', 'sort', 'dir']) next.delete(k);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  };

  const emp = (r: { employee: { name: string; employeeNo: string | null } }) => `${r.employee.name}${r.employee.employeeNo ? ` (${r.employee.employeeNo})` : ''}`;
  const headerCols: ListColumn<ClaimListRow>[] = [
    { key: 'claimNo', header: 'Claim no.', value: (r) => r.claimNo },
    { key: 'employee', header: 'Employee', value: emp },
    { key: 'department', header: 'Department', sortable: false, priority: 'low', value: (r) => r.department },
    { key: 'title', header: 'Title', sortable: false, value: (r) => r.title },
    { key: 'lines', header: 'Lines', align: 'right', sortable: false, priority: 'low', value: (r) => r.lineCount },
    { key: 'total', header: 'Total (RM)', kind: 'money', value: (r) => formatAmount(r.total), render: (r) => <MoneyCell v={r.total} /> },
    { key: 'sst', header: 'SST (RM)', kind: 'money', sortable: false, priority: 'low', hideOnCard: true, value: (r) => formatAmount(r.totalSst), render: (r) => <MoneyCell v={r.totalSst} /> },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => claimStatusText(r.status), render: (r) => <ClaimStatusChip status={r.status} /> },
    { key: 'flags', header: 'Flags', sortable: false, priority: 'low', hideOnCard: true, value: (r) => flagsText(r.flags), render: (r) => <ClaimFlags flags={r.flags} /> },
    { key: 'submitted', header: 'Submitted', kind: 'date', value: (r) => formatDateTime(r.submittedAt), render: (r) => <DateText value={r.submittedAt} /> },
    { key: 'decided', header: 'Approved / rejected by & date', sortable: false, priority: 'low', hideOnCard: true, value: (r) => (r.decidedAt ? `${r.decidedByName ?? ''} · ${formatDate(r.decidedAt)}` : '') },
    ...(admin
      ? ([
          { key: 'batch', header: 'Batch', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.batchNo ?? '' },
          { key: 'disbursed', header: 'Disbursed on', kind: 'date', sortable: false, priority: 'low', hideOnCard: true, value: (r) => formatDate(r.disbursedOn), render: (r) => <DateText value={r.disbursedOn} /> },
          { key: 'ref', header: 'Payment ref', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.paymentReference ?? '' },
        ] as ListColumn<ClaimListRow>[])
      : []),
  ];
  const lineCols: ListColumn<ClaimLineListRow>[] = [
    { key: 'employee', header: 'Employee', value: emp },
    { key: 'transaction', header: 'Date of transaction', kind: 'date', value: (r) => formatDate(r.transactionDate), render: (r) => <DateText value={r.transactionDate} /> },
    { key: 'submitted', header: 'Date of application', kind: 'date', value: (r) => formatDate(r.submittedAt), render: (r) => <DateText value={r.submittedAt} /> },
    { key: 'category', header: 'Category', sortable: false, value: (r) => r.category.name },
    { key: 'info', header: 'More info', sortable: false, value: (r) => r.moreInfo },
    { key: 'total', header: 'Amount (RM)', kind: 'money', value: (r) => formatAmount(r.amountInclSst), render: (r) => <MoneyCell v={r.amountInclSst} /> },
    { key: 'sst', header: 'SST (RM)', kind: 'money', sortable: false, priority: 'low', value: (r) => formatAmount(r.sstAmount), render: (r) => <MoneyCell v={r.sstAmount} /> },
    { key: 'att', header: '📎', sortable: false, align: 'center', priority: 'low', hideOnCard: true, value: (r) => (r.attachmentCount ? r.attachmentCount : '') },
    { key: 'receipt', header: 'Receipt / e-Invoice no.', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.receiptNo ?? '' },
    { key: 'uuid', header: 'UUID', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.myinvoisUuid ?? '' },
    { key: 'decidedAt', header: 'Date of approval / rejection', kind: 'date', sortable: false, priority: 'low', hideOnCard: true, value: (r) => formatDate(r.decidedAt), render: (r) => <DateText value={r.decidedAt} /> },
    { key: 'decidedBy', header: 'Approved / rejected by', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.decidedByName ?? '' },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => claimStatusText(r.status), render: (r) => <ClaimStatusChip status={r.status} /> },
    ...(admin
      ? ([
          { key: 'batch', header: 'Batch', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.batchNo ?? '' },
          { key: 'disbursed', header: 'Disbursed on', kind: 'date', sortable: false, priority: 'low', hideOnCard: true, value: (r) => formatDate(r.disbursedOn), render: (r) => <DateText value={r.disbursedOn} /> },
        ] as ListColumn<ClaimLineListRow>[])
      : []),
  ];

  const filters: React.ReactNode[] = [
    <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Claim no., employee no. or name, receipt / e-Invoice no., UUID." />,
  ];
  if (admin)
    filters.push(
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
    );
  filters.push(
    <MultiSelectFilter key="dp" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={options.departments.map((x) => ({ value: x.id, label: x.label }))} />,
    <MultiSelectFilter key="c" label="Category" value={d.categoryIds} onChange={(v) => set('categoryIds', v)} options={options.categories.map((x) => ({ value: x.id, label: x.label }))} />,
    <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={CLAIM_STATUS_OPTIONS} />,
    <DateFilter key="f" label="Transaction from" value={d.from} onChange={(v) => set('from', v)} />,
    <DateFilter key="t" label="Transaction to" value={d.to} onChange={(v) => set('to', v)} />,
  );
  if (more) {
    filters.push(
      <DateFilter key="sf" label="Submitted from" value={d.submittedFrom} onChange={(v) => set('submittedFrom', v)} />,
      <DateFilter key="st" label="Submitted to" value={d.submittedTo} onChange={(v) => set('submittedTo', v)} />,
      <DateFilter key="df" label="Approval date from" value={d.decidedFrom} onChange={(v) => set('decidedFrom', v)} />,
      <DateFilter key="dt" label="Approval date to" value={d.decidedTo} onChange={(v) => set('decidedTo', v)} />,
    );
    if (admin)
      filters.push(
        <DateFilter key="bf" label="Disbursement from" value={d.disbursedFrom} onChange={(v) => set('disbursedFrom', v)} />,
        <DateFilter key="bt" label="Disbursement to" value={d.disbursedTo} onChange={(v) => set('disbursedTo', v)} />,
        <SelectFilter key="b" label="Batch" value={d.batchNo} onChange={(v) => set('batchNo', v)} options={options.batches.map((b) => ({ value: b.batchNo, label: b.batchNo }))} />,
      );
    filters.push(
      <MultiSelectFilter key="fl" label="Flags" value={d.flags} onChange={(v) => set('flags', v)} options={CLAIM_FLAG_OPTIONS} />,
      <SelectFilter key="ob" label="On behalf only" value={d.onBehalfOnly} onChange={(v) => set('onBehalfOnly', v)} options={[{ value: 'yes', label: 'Yes' }]} />,
      <SelectFilter key="is" label="Include separated employees" value={d.includeSeparated} onChange={(v) => set('includeSeparated', v)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />,
    );
  }
  filters.push(
    <Button key="more" variant="text" onClick={() => setMore((m) => !m)} sx={{ minHeight: 40 }}>
      {more ? 'Fewer filters ◂' : 'More filters ▸'}
    </Button>,
  );

  const exportXlsx = () => openDownload(() => exportClaimsXlsx(params), (m) => toast.info(m));
  const extra = (
    <>
      {admin && (
        <Button variant="contained" color="success" onClick={exportXlsx}>
          Export .xlsx
        </Button>
      )}
      {admin && (
        <Button variant="outlined" onClick={() => setDlg('autocount')}>
          AutoCount export
        </Button>
      )}
      {admin && (
        <Button variant="outlined" onClick={() => setDlg('zip')}>
          Download attachments
        </Button>
      )}
      {admin && (
        <Tooltip title="Summary report arrives with the reports module (W2-007).">
          <span>
            <Button variant="outlined" disabled>
              Summary report
            </Button>
          </span>
        </Tooltip>
      )}
    </>
  );

  const k = page.kpis;
  const kpiStrip = (
    <Card sx={{ p: 2 }}>
      <Grid container spacing={1.5}>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiTile label="Submitted" value={k.submitted} tone={k.submitted ? 'warning' : 'grey'} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiTile label="Approved (not disbursed)" value={k.approvedNotDisbursed} tone="info" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiTile label="Disbursed" value={k.disbursed} tone="success" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <KpiTile label="Rejected" value={k.rejected} tone="grey" />
        </Grid>
      </Grid>
      <Typography variant="body2" sx={{ mt: 1.5 }} className="pret-tnum">
        Total excl. SST <MoneyText amount={k.totalExclSst} bold /> · Total SST <MoneyText amount={k.totalSst} bold /> · Total <MoneyText amount={k.total} bold />
      </Typography>
    </Card>
  );

  const common = {
    itemName: { singular: 'claim', plural: page.view === 'line' ? 'claim lines' : 'claims' },
    filters,
    ...list.listProps,
    total: page.total,
    extraActions: extra,
    addNew: admin ? { label: 'Submit on behalf', href: '/claims/new-on-behalf' } : undefined,
    onExport: async () => {
      try {
        const res = await exportClaimsCsv(params);
        if (res.ok) downloadServerCsv(res.filename || (admin ? 'claims' : 'team-claims'), res.content);
        else toast.info(res.error);
      } catch {
        toast.info('Export failed. Please try again.');
      }
    },
  };

  const selectable = page.view === 'header' ? page.rows.filter((r) => r.canDecide && r.taskId).map((r) => r.id) : [];
  const headerRows = page.view === 'header' ? page.rows : [];

  return (
    <Stack spacing={2}>
      {kpiStrip}
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
        <Typography variant="body2" color="text.secondary">
          View
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={page.view} onChange={(_e, v) => v && switchView(v)} aria-label="List view">
          <ToggleButton value="header">Header</ToggleButton>
          <ToggleButton value="line">Line</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {page.view === 'header' ? (
        <ListPage<ClaimListRow>
          {...common}
          columns={headerCols}
          rows={page.rows}
          getRowId={(r) => r.id}
          getRowHref={(r) => href(r.claimNo)}
          getRowRef={(r) => r.claimNo}
          selectable={selectable.length > 0}
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
          empty={{ title: admin ? 'No claims yet.' : 'No team claims yet.' }}
        />
      ) : (
        <ListPage<ClaimLineListRow>
          {...common}
          columns={lineCols}
          rows={page.rows}
          getRowId={(r) => r.lineId}
          getRowHref={(r) => href(r.claimNo)}
          getRowRef={(r) => `${r.claimNo} line ${r.lineNo}`}
          empty={{ title: 'No claim lines yet.' }}
        />
      )}
      <Box>
        <Typography variant="caption" color="text.secondary">
          {admin ? 'Bank account numbers never appear in these exports. Downloads are logged.' : 'Team scope: your reportees and claims routed to you. Batch and bank details are not shown.'}
        </Typography>
      </Box>
      <BulkDecisionDialog
        open={bulk !== null}
        decision={bulk ?? 'approve'}
        rejectWord="Reject"
        items={headerRows.filter((r) => selected.includes(r.id) && r.taskId).map((r) => ({ taskId: r.taskId!, reference: r.claimNo }))}
        itemLabel="claims"
        onClose={() => setBulk(null)}
        onDone={() => setSelected([])}
      />
      {admin && <AutocountDialog open={dlg === 'autocount'} onClose={() => setDlg(null)} batches={options.batches} />}
      {admin && <AttachmentBundleDialog open={dlg === 'zip'} onClose={() => setDlg(null)} input={{ scope: 'filter', filter: params }} scopeLabel="Current filter" />}
    </Stack>
  );
}
