'use client';

// P12 · My claims — S-PT-12 · /my/claims · F-CLM-13, F-CLM-20 · US-CLAIM-016
// Utilisation panel (per category with a limit: Category · Period · Used · Limit · Remaining; "No limit" collapsed) ·
// BR-CLM-27 banner for New claims older than 90 days · Search claim no./title · Filters Status (multi) · Category (multi) ·
// Year · Transaction date from–to · Columns Claim no. › · Title · Lines · Total (RM) · Status · Flags · Submitted ·
// Disbursed on · Payment reference · ⋮ (New → EDIT, SUBMIT, DELETE · Submitted → WITHDRAW · Rejected → COPY TO NEW CLAIM) ·
// NEW CLAIM · EXPORT .CSV. Phone card "CL-… · ●Status" / title / "3 lines · RM 245.60" / "Submitted dd/mm/yyyy".
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import type { CategoryRef, LimitUtilisation, MyClaimRow, MyClaimsPage, MyClaimsParams } from '@/server/contracts/claims';
import { exportMyClaimsCsv } from '@/server/actions/claims';
import ListPage, { type ListColumn, type RowAction } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import { formatAmount, formatDate, formatDateTime } from '@/lib/format';
import { CLAIM_STATUS_OPTIONS, ClaimFlags, ClaimStatusChip, MoneyCell, UtilisationPanel, claimStatusText, claimYearOptions, flagsText } from './common';
import OwnClaimDialogs, { type OwnClaimTarget } from './OwnClaimDialogs';
import { MY_CLAIM_FILTERS } from './filters';

export function myClaimActions(r: Pick<MyClaimRow, 'id' | 'claimNo' | 'can'>, open: (t: OwnClaimTarget) => void, push: (href: string) => void): RowAction[] {
  const base = { claimId: r.id, claimNo: r.claimNo, editHref: `/my/claims/${encodeURIComponent(r.claimNo)}/edit` };
  const a: RowAction[] = [];
  if (r.can.edit) a.push({ label: 'Edit', onClick: () => push(base.editHref) });
  if (r.can.submit) a.push({ label: 'Submit', onClick: () => open({ kind: 'submit', ...base }) });
  if (r.can.delete) a.push({ label: 'Delete', danger: true, onClick: () => open({ kind: 'delete', ...base }) });
  if (r.can.withdraw) a.push({ label: 'Withdraw', danger: true, onClick: () => open({ kind: 'withdraw', ...base }) });
  if (r.can.copy) a.push({ label: 'Copy to new claim', onClick: () => open({ kind: 'copy', ...base }) });
  return a;
}

export default function MyClaimsList({
  page,
  params,
  categories,
  utilisation,
  currentYear,
}: {
  page: MyClaimsPage;
  params: MyClaimsParams;
  categories: CategoryRef[];
  utilisation: LimitUtilisation | null;
  currentYear: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const list = useServerList({ filters: { ...MY_CLAIM_FILTERS, year: String(currentYear) }, sort: { key: 'created', direction: 'desc' } });
  const [target, setTarget] = React.useState<OwnClaimTarget | null>(null);
  const d = list.draft;
  const set = list.setDraftField;

  const columns: ListColumn<MyClaimRow>[] = [
    { key: 'claimNo', header: 'Claim no.', value: (r) => r.claimNo },
    { key: 'title', header: 'Title', sortable: false, value: (r) => r.title },
    { key: 'lines', header: 'Lines', align: 'right', sortable: false, priority: 'low', value: (r) => r.lineCount },
    { key: 'total', header: 'Total (RM)', kind: 'money', value: (r) => formatAmount(r.total), render: (r) => <MoneyCell v={r.total} /> },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => claimStatusText(r.status), render: (r) => <ClaimStatusChip status={r.status} /> },
    { key: 'flags', header: 'Flags', sortable: false, priority: 'low', hideOnCard: true, value: (r) => flagsText(r.flags), render: (r) => <ClaimFlags flags={r.flags} /> },
    { key: 'submitted', header: 'Submitted', kind: 'date', value: (r) => formatDateTime(r.submittedAt), render: (r) => <DateText value={r.submittedAt} /> },
    { key: 'disbursed', header: 'Disbursed on', kind: 'date', sortable: false, priority: 'low', hideOnCard: true, value: (r) => formatDate(r.disbursedOn), render: (r) => <DateText value={r.disbursedOn} /> },
    { key: 'ref', header: 'Payment reference', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.paymentReference ?? '' },
  ];

  return (
    <Stack spacing={2}>
      <UtilisationPanel u={utilisation} />
      {page.staleNewCount > 0 && (
        <Alert severity="warning">
          {page.staleNewCount} {page.staleNewCount === 1 ? 'claim' : 'claims'} saved more than {page.staleDays} days ago {page.staleNewCount === 1 ? 'is' : 'are'} still not submitted.
        </Alert>
      )}
      <ListPage<MyClaimRow>
        itemName={{ singular: 'claim', plural: 'claims' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Claim no. or title." />,
          <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={CLAIM_STATUS_OPTIONS} />,
          <MultiSelectFilter key="c" label="Category" value={d.categoryIds} onChange={(v) => set('categoryIds', v)} options={categories.map((c) => ({ value: c.id, label: c.name }))} />,
          <SelectFilter key="y" label="Year" value={d.year} onChange={(v) => set('year', v)} options={claimYearOptions(currentYear)} />,
          <DateFilter key="f" label="Transaction from" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="t" label="Transaction to" value={d.to} onChange={(v) => set('to', v)} />,
        ]}
        {...list.listProps}
        addNew={{ label: 'New claim', href: '/my/claims/new' }}
        onExport={async () => {
          try {
            const res = await exportMyClaimsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'my-claims', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={page.rows}
        total={page.total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/my/claims/${encodeURIComponent(r.claimNo)}`}
        getRowRef={(r) => r.claimNo}
        rowActions={(r) => myClaimActions(r, setTarget, (h) => router.push(h))}
        empty={{
          title: 'No claims yet.',
          action: (
            <Button variant="contained" component={NextLink} href="/my/claims/new">
              New claim
            </Button>
          ),
        }}
      />
      <OwnClaimDialogs target={target} onClose={() => setTarget(null)} />
    </Stack>
  );
}
