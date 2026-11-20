'use client';

// P5 · My balances — S-PT-05 · /my/leave/balances · F-LV-21 · US-LEAVE-028
//   Leave year selector (current, previous, next if generated) · one card per visible type: Available (large) ·
//   Entitled · Carried forward · Earned · Adjustments · Taken · Pending · Expired/forfeited · Balance · Earned to
//   date (accrual) · expiring items with dates · Sick/Hospitalisation pool line · VIEW LEDGER › · YEARLY LEAVE REPORT.
// P6 · Balance ledger — S-PT-06 · /my/leave/balances/{type}?year= (ADM/SA: /leave/balances/{employeeNo}/{type}) · F-LV-28
//   Filters Year · Transaction (multi) · Date from–to · Search reference · Columns Date · Transaction · Days (±) ·
//   Reference › · Running balance · By · EXPORT .CSV · default Date asc.
// BalanceCards is reused on the E3 Leave tab and the P32 team-member view (no ledger link for MGR — F-LV-28).
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  LEDGER_TRANSACTIONS,
  LEDGER_TRANSACTION_LABELS,
  type BalanceCard,
  type LedgerPage,
  type LedgerParams,
  type LedgerRow,
  type MyBalances,
} from '@/server/contracts/leave';
import { exportLedgerCsv } from '@/server/actions/leave';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import EmptyState from '../EmptyState';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import { formatDate } from '@/lib/format';
import { DaysCell, PanelRow, formatDays, formatSignedDays } from './common';
import { MyLeaveTabs } from './MyLeave';
import { LEDGER_FILTERS } from './filters';

/** One P5 card (also E3 Leave tab, P32). */
export function BalanceCardView({ c, ledgerHref }: { c: BalanceCard; ledgerHref?: string | null }) {
  const noBalance = c.leaveType.entitlementMethod === 'no_entitlement' || c.leaveType.entitlementMethod === 'fixed_per_occurrence';
  const avail = Number(c.available);
  return (
    <Card sx={{ height: '100%' }}>
      <Box sx={{ display: 'flex', height: '100%' }}>
        <Box aria-hidden sx={{ width: 4, flexShrink: 0, bgcolor: c.leaveType.colour }} />
        <CardContent sx={{ flex: 1, p: 2, '&:last-child': { pb: 2 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
            <Typography variant="h6" component="h2">
              {c.leaveType.name}
            </Typography>
            {noBalance ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>
                {c.availableLabel}
              </Typography>
            ) : (
              <Typography component="p" className="pret-tnum" sx={{ fontSize: 22, fontWeight: 700, color: avail < 0 ? '#B42318' : 'text.primary', whiteSpace: 'nowrap' }}>
                {avail < 0 ? `−${formatDays(Math.abs(avail))}` : formatDays(c.available)}{' '}
                <Typography component="span" variant="body2" color="text.secondary">
                  available
                </Typography>
              </Typography>
            )}
          </Stack>
          {!noBalance && (
            <Box sx={{ mt: 1 }}>
              <PanelRow label="Entitled" value={formatDays(c.entitled)} />
              <PanelRow label="Carried forward" value={formatDays(c.carriedForward)} />
              <PanelRow label="Earned (credits)" value={formatDays(c.earned)} />
              <PanelRow label="Adjustments" value={formatSignedDays(c.adjustments)} />
              <PanelRow label="Taken" value={`−${formatDays(c.taken)}`} />
              <PanelRow label="Pending" value={`−${formatDays(c.pending)}`} />
              <PanelRow label="Expired / forfeited" value={formatDays(c.expiredForfeited)} />
              <PanelRow label="Balance" value={formatDays(c.balance)} strong />
              {c.earnedToDate && <PanelRow label="Earned to date (accrual)" value={formatDays(c.earnedToDate)} tone="muted" />}
            </Box>
          )}
          {c.occurrences && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              Occurrences used: {c.occurrences.used}
              {c.occurrences.max != null ? ` of ${c.occurrences.max}` : ''}
            </Typography>
          )}
          {c.pool && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {c.pool.label}: {formatDays(c.pool.used)} of {formatDays(c.pool.cap)} used
            </Typography>
          )}
          {c.expiring.map((e) => (
            <Typography key={`${e.kind}-${e.date}`} variant="body2" sx={{ mt: 1, color: '#B45309', display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <WarningAmberIcon sx={{ fontSize: 16 }} aria-hidden />
              {formatDays(e.days)} {e.kind === 'carry_forward' ? 'carried forward' : 'replacement credit'} expires {formatDate(e.date)}
            </Typography>
          ))}
          {ledgerHref && (
            <Box sx={{ textAlign: 'right', mt: 1 }}>
              <Button size="small" component={NextLink} href={ledgerHref}>
                View ledger ›
              </Button>
            </Box>
          )}
        </CardContent>
      </Box>
    </Card>
  );
}

export function BalanceCards({ cards, ledgerHref, empty }: { cards: BalanceCard[]; ledgerHref?: (c: BalanceCard) => string | null; empty: string }) {
  if (cards.length === 0) return <EmptyState title={empty} />;
  return (
    <Grid container spacing={2}>
      {cards.map((c) => (
        <Grid key={c.leaveType.id} size={{ xs: 12, sm: 6, lg: 4 }}>
          <BalanceCardView c={c} ledgerHref={ledgerHref?.(c) ?? null} />
        </Grid>
      ))}
    </Grid>
  );
}

/** Year selector that writes ?year= (server re-reads). */
export function YearSelect({ year, years, label = 'Leave year' }: { year: number; years: number[]; label?: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const sp = useSearchParams();
  const [pending, start] = React.useTransition();
  const hrefFor = (y: string) => {
    const next = new URLSearchParams(sp?.toString() ?? '');
    next.set('year', y);
    return `${pathname}?${next.toString()}`;
  };
  return (
    <TextField
      select
      size="small"
      label={label}
      value={String(year)}
      disabled={pending}
      onChange={(e) => start(() => router.replace(hrefFor(e.target.value), { scroll: false }))}
      sx={{ minWidth: 140 }}
    >
      {(years.length ? years : [year]).map((y) => (
        <MenuItem key={y} value={String(y)}>
          {y}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function MyBalancesView({ data }: { data: MyBalances }) {
  return (
    <>
      <MyLeaveTabs />
      <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <YearSelect year={data.year} years={data.years} />
        {/* P7 yearly report is a W2-007 report screen (brief §3) */}
        <Button variant="text" disabled title="Available after W2-007">
          Yearly leave report (after W2-007)
        </Button>
      </Stack>
      <BalanceCards
        cards={data.cards}
        empty={`No leave entitlements for ${data.year} yet.`}
        ledgerHref={(c) => `/my/leave/balances/${encodeURIComponent(c.leaveType.code)}?year=${data.year}`}
      />
    </>
  );
}

/** P6 ledger (own or ADM/SA view of an employee). */
export function LedgerView({ page, params, years, selfView }: { page: LedgerPage; params: LedgerParams; years: number[]; selfView: boolean }) {
  const list = useServerList({ filters: { ...LEDGER_FILTERS, year: String(page.year) }, rowsPerPage: 50, sort: { key: 'date', direction: 'asc' } });
  const toast = useToast();
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<LedgerRow>[] = [
    { key: 'date', header: 'Date', kind: 'date', value: (r) => formatDate(r.date), render: (r) => <DateText value={r.date} /> },
    {
      key: 'transaction',
      header: 'Transaction',
      sortable: false,
      value: (r) => (r.isOpening ? LEDGER_TRANSACTION_LABELS.opening : LEDGER_TRANSACTION_LABELS[r.transaction]),
      render: (r) => (
        <Box>
          {r.isOpening ? LEDGER_TRANSACTION_LABELS.opening : LEDGER_TRANSACTION_LABELS[r.transaction]}
          {r.reason && (
            <Typography variant="caption" color="text.secondary" component="p">
              {r.reason}
            </Typography>
          )}
          {r.expiresOn && (
            <Typography variant="caption" color="text.secondary" component="p">
              Expires {formatDate(r.expiresOn)}
            </Typography>
          )}
        </Box>
      ),
    },
    { key: 'days', header: 'Days', align: 'right', sortable: false, value: (r) => formatSignedDays(r.days), render: (r) => <DaysCell value={r.days} signed /> },
    {
      key: 'reference',
      header: 'Reference',
      sortable: false,
      value: (r) => r.reference?.label ?? '',
      render: (r) =>
        r.reference ? (
          r.reference.href ? (
            <Link component={NextLink} href={r.reference.href}>
              {r.reference.label} ›
            </Link>
          ) : (
            r.reference.label
          )
        ) : (
          '—'
        ),
    },
    { key: 'running', header: 'Running balance', align: 'right', sortable: false, value: (r) => formatDays(r.runningBalance), render: (r) => <DaysCell value={r.runningBalance} /> },
    { key: 'by', header: 'By', sortable: false, value: (r) => r.byName },
  ];
  return (
    <>
      {selfView && <MyLeaveTabs />}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Typography variant="h5" component="h2">
            {page.leaveType.name} · {page.year}
            {!selfView && ` · ${page.employee.name}${page.employee.employeeNo ? ` (${page.employee.employeeNo})` : ''}`}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Closing balance {formatDays(page.closingBalance)} days
          </Typography>
        </CardContent>
      </Card>
      <ListPage<LedgerRow>
        itemName={{ singular: 'ledger entry', plural: 'ledger entries' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Reference (LV-… / RL-…)." />,
          <SelectFilter key="y" label="Year" value={d.year} onChange={(v) => set('year', v)} options={(years.length ? years : [page.year]).map((y) => ({ value: String(y), label: String(y) }))} />,
          <MultiSelectFilter key="t" label="Transaction type" value={d.transactions} onChange={(v) => set('transactions', v)} options={LEDGER_TRANSACTIONS.map((t) => ({ value: t, label: LEDGER_TRANSACTION_LABELS[t] }))} />,
          <DateFilter key="f" label="Date from" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="to" label="Date to" value={d.to} onChange={(v) => set('to', v)} />,
        ]}
        {...list.listProps}
        onExport={async () => {
          try {
            const res = await exportLedgerCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'leave-ledger', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={page.rows}
        total={page.total}
        getRowId={(r) => r.id}
        empty={{ title: `No ledger entries for ${page.leaveType.name} in ${page.year}.` }}
      />
    </>
  );
}
