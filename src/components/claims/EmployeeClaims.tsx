'use client';

// E3 profile · Claims tab (ADM/SA) — wireframes-employees.md tab 11: Claim no. › · Title · Total · Status · Submitted ·
//   Approved by · Batch/run · Disbursed on · SUBMIT ON BEHALF (S-CL-02) · utilisation panel · filters Status / Year · EXPORT .CSV.
// P32 team member · Claims (MGR) — reportee's claims in team scope (no batch / bank data) + utilisation.
import * as React from 'react';
import NextLink from 'next/link';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { CLAIM_STATUSES, type EmployeeClaimRow, type EmployeeClaimsTab, type TeamMemberClaims } from '@/server/contracts/claims';
import { pickList } from '../employees/filters';
import { exportClaimsCsv } from '@/server/actions/claims';
import ListPage, { type ListColumn } from '../list/ListPage';
import { MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import { MiniTable } from '../employees/ui';
import { formatAmount, formatDate } from '@/lib/format';
import { CLAIM_STATUS_OPTIONS, ClaimFlags, ClaimStatusChip, MoneyCell, UtilisationPanel, claimStatusText, claimYearOptions } from './common';
import { EMPLOYEE_CLAIM_FILTERS } from './filters';

export function EmployeeClaimsTabView({ tab, employeeId, currentYear }: { tab: EmployeeClaimsTab | null; employeeId: string; currentYear: number }) {
  const toast = useToast();
  const list = useServerList({ filters: EMPLOYEE_CLAIM_FILTERS, preserve: ['tab'] });
  const d = list.draft;
  const set = list.setDraftField;
  if (!tab) return <Typography color="text.secondary">Claims are not available for this employee.</Typography>;
  const columns: ListColumn<EmployeeClaimRow>[] = [
    { key: 'claimNo', header: 'Claim no.', sortable: false, value: (r) => r.claimNo },
    { key: 'title', header: 'Title', sortable: false, value: (r) => r.title },
    { key: 'total', header: 'Total (RM)', kind: 'money', sortable: false, value: (r) => formatAmount(r.total), render: (r) => <MoneyCell v={r.total} /> },
    { key: 'status', header: 'Status', kind: 'status', sortable: false, value: (r) => claimStatusText(r.status), render: (r) => <ClaimStatusChip status={r.status} /> },
    { key: 'flags', header: 'Flags', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.flags.join(', '), render: (r) => <ClaimFlags flags={r.flags} /> },
    { key: 'submitted', header: 'Submitted', kind: 'date', sortable: false, value: (r) => formatDate(r.submittedAt), render: (r) => <DateText value={r.submittedAt} /> },
    { key: 'approver', header: 'Approved by', sortable: false, priority: 'low', value: (r) => r.approvedByName ?? '' },
    { key: 'batch', header: 'Batch / run', sortable: false, priority: 'low', hideOnCard: true, value: (r) => r.batchNo ?? '' },
    { key: 'disbursed', header: 'Disbursed on', kind: 'date', sortable: false, priority: 'low', value: (r) => formatDate(r.disbursedOn), render: (r) => <DateText value={r.disbursedOn} /> },
  ];
  return (
    <Stack spacing={2}>
      <UtilisationPanel u={tab.utilisation} title="Limit utilisation" />
      <ListPage<EmployeeClaimRow>
        itemName={{ singular: 'claim', plural: 'claims' }}
        filters={[
          <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={CLAIM_STATUS_OPTIONS} />,
          <SelectFilter key="y" label="Year" value={d.year} onChange={(v) => set('year', v)} options={claimYearOptions(currentYear)} />,
        ]}
        {...list.listProps}
        onSortChange={undefined}
        addNew={tab.canSubmitOnBehalf && tab.submitOnBehalfHref ? { label: 'Submit on behalf', href: tab.submitOnBehalfHref } : undefined}
        onExport={async () => {
          const res = await exportClaimsCsv({ employeeId, statuses: pickList(list.applied.filters.statuses, CLAIM_STATUSES), page: 1, pageSize: 100 });
          if (res.ok) downloadServerCsv(res.filename || 'employee-claims', res.content);
          else toast.info(res.error);
        }}
        columns={columns}
        rows={tab.claims.rows}
        total={tab.claims.total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/approvals/claims/${encodeURIComponent(r.claimNo)}?from=claims`}
        getRowRef={(r) => r.claimNo}
        empty={{ title: 'No claims yet.' }}
      />
    </Stack>
  );
}

export function TeamMemberClaimsView({ claims }: { claims: TeamMemberClaims | null }) {
  if (!claims) return <Typography color="text.secondary">Claims are not available for this team member.</Typography>;
  return (
    <Stack spacing={2}>
      <UtilisationPanel u={claims.utilisation} />
      <Card>
        <CardContent>
          <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
              Claims ({claims.submittedCount} waiting for approval)
            </Typography>
            {claims.submittedCount > 0 && (
              <Button component={NextLink} href="/approvals?tab=claims">
                Open approvals
              </Button>
            )}
          </Stack>
          <MiniTable
            caption="Team member claims"
            rows={claims.rows}
            getRowId={(r) => r.id}
            empty="No claims yet."
            columns={[
              { key: 'n', header: 'Claim no.', render: (r) => <NextLink href={`/approvals/claims/${encodeURIComponent(r.claimNo)}?from=team`}>{r.claimNo}</NextLink> },
              { key: 't', header: 'Title', render: (r) => r.title },
              { key: 'm', header: 'Total (RM)', align: 'right', render: (r) => <MoneyCell v={r.total} /> },
              { key: 's', header: 'Status', render: (r) => <ClaimStatusChip status={r.status} /> },
              { key: 'f', header: 'Flags', render: (r) => <ClaimFlags flags={r.flags} /> },
              { key: 'd', header: 'Submitted', render: (r) => formatDate(r.submittedAt) || '—' },
              { key: 'a', header: 'Approved by', render: (r) => r.approvedByName ?? '—' },
              { key: 'x', header: 'Disbursed on', render: (r) => formatDate(r.disbursedOn) || '—' },
            ]}
          />
        </CardContent>
      </Card>
    </Stack>
  );
}
