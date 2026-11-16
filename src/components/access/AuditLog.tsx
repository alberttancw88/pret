'use client';

// A9 · Audit & access log — S-AC-05 · /audit · F-ADM-09/10/11 · US-ADMIN-009–011 · SA only.
// Filters: Date from–to * (default last 7 days) · Actor · User type (External only) · Action (multi) ·
// Entity type · Data category (multi) · Search entity reference. (Employee concerned → W2-003.)
// Columns: Timestamp (dd/mm/yyyy HH:mm:ss) · Actor (+ roles at the time) · Action ·
// Entity / reference › · Employee concerned · Data categories · Reason · 👁. EXPORT .CSV (logged).
// Row → S-AC-06 entry detail dialog: AU1–AU10, field changes (masked; REVEAL logged) · IP ·
// user agent · on behalf of. Append-only: there are no edit or delete controls anywhere.
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  DATA_CATEGORIES,
  DATA_CATEGORY_LABELS,
  USER_TYPE_LABELS,
  type AuditEntryDetail,
  type AuditFilterOptions,
  type AuditListParams,
  type AuditRow,
} from '@/server/contracts/users';
import { exportAuditEntriesCsv, revealAuditEntry } from '@/server/actions/users';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { useServerList, downloadServerCsv } from '../list/useServerList';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import ReasonDialog from '../dialogs/ReasonDialog';
import { FormGrid, FullRow, KeyValue } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import { useToast } from '../ToastProvider';
import { AUDIT_FILTERS } from './filters';
import { deviceLabel } from './UserDetailView';
import { formatDateTime } from '@/lib/format';

const ts = (iso: string) => formatDateTime(iso, { seconds: true });
const actorText = (r: AuditRow) => {
  const who = r.actorName ?? r.actorLabel ?? 'System';
  const roles = r.actorRoles.length ? ` (${r.actorRoles.join(', ')})` : '';
  const ext = r.actorUserType === 'external' ? ' · External' : '';
  return `${who}${roles}${ext}`;
};
const entityText = (r: AuditRow) => `${r.entityType}${r.entityRef ? ` ${r.entityRef}` : ''}`;
const catsText = (r: AuditRow) => r.dataCategories.map((c) => DATA_CATEGORY_LABELS[c]).join(', ');

export default function AuditLog({
  rows,
  total,
  params,
  defaults,
  options,
  entry,
}: {
  rows: AuditRow[];
  total: number;
  params: AuditListParams;
  /** Default from/to (last 7 days, MYT) computed by the page. */
  defaults: { from: string; to: string };
  options: AuditFilterOptions;
  entry: AuditEntryDetail | null;
}) {
  const list = useServerList({ filters: { ...AUDIT_FILTERS, ...defaults }, sort: { key: 'occurredAt', direction: 'desc' } });
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const toast = useToast();
  const [navPending, startNav] = React.useTransition();
  const d = list.draft;
  const set = list.setDraftField;

  const setEntry = (key: string | null) => {
    const sp = new URLSearchParams(search?.toString() ?? '');
    if (key) sp.set('entry', key);
    else sp.delete('entry');
    const qs = sp.toString();
    startNav(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };
  const [openKey, setOpenKey] = React.useState<string | null>(entry?.key ?? null);
  const [revealed, setRevealed] = React.useState<AuditEntryDetail | null>(null);
  const [revealOpen, setRevealOpen] = React.useState(false);
  const revealRun = useActionRunner();
  const open = (r: AuditRow) => {
    setOpenKey(r.key);
    setRevealed(null);
    setEntry(r.key);
  };
  const close = () => {
    setOpenKey(null);
    setRevealed(null);
    setEntry(null);
  };
  const shown = revealed && revealed.key === openKey ? revealed : entry && entry.key === openKey ? entry : null;

  const columns: ListColumn<AuditRow>[] = [
    {
      key: 'occurredAt',
      header: 'Timestamp',
      kind: 'date',
      value: (r) => ts(r.occurredAt),
      render: (r) => (
        <Link component="button" type="button" onClick={() => open(r)} className="pret-tnum" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
          {ts(r.occurredAt)}
        </Link>
      ),
    },
    { key: 'actor', header: 'Actor', sortable: false, minWidth: 180, value: actorText },
    { key: 'action', header: 'Action', sortable: false, value: (r) => AUDIT_ACTION_LABELS[r.action] },
    {
      key: 'entity',
      header: 'Entity / reference',
      sortable: false,
      minWidth: 180,
      value: entityText,
      render: (r) => (
        <Link component="button" type="button" onClick={() => open(r)} sx={{ textAlign: 'left' }}>
          {entityText(r)}
        </Link>
      ),
    },
    { key: 'employee', header: 'Employee concerned', sortable: false, priority: 'low', value: (r) => (r.employeeIds.length ? `${r.employeeIds.length} employee(s)` : '') },
    { key: 'categories', header: 'Data categories', sortable: false, value: catsText },
    { key: 'reason', header: 'Reason', sortable: false, priority: 'low', value: (r) => r.reason ?? '' },
  ];

  const actorOptions = options.actors.map((a) => ({ value: a.id, label: `${a.displayName}${a.userType === 'external' ? ' · External' : ''}` }));

  return (
    <>
      <ListPage<AuditRow>
        itemName={{ singular: 'log entry', plural: 'log entries' }}
        filters={[
          <DateFilter key="from" label="Date from *" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="to" label="Date to *" value={d.to} onChange={(v) => set('to', v)} />,
          <SelectFilter key="actor" label="Actor" value={d.actorUserId} onChange={(v) => set('actorUserId', v)} options={actorOptions} />,
          <SelectFilter key="ext" label="User type" value={d.externalOnly} onChange={(v) => set('externalOnly', v)} options={[{ value: 'yes', label: 'External only' }]} />,
          <MultiSelectFilter key="actions" label="Action" value={d.actions} onChange={(v) => set('actions', v)} options={AUDIT_ACTIONS.map((a) => ({ value: a, label: AUDIT_ACTION_LABELS[a] }))} />,
          <SelectFilter key="entity" label="Entity type" value={d.entityType} onChange={(v) => set('entityType', v)} options={options.entityTypes.map((e) => ({ value: e, label: e }))} />,
          <MultiSelectFilter key="cats" label="Data category" value={d.categories} onChange={(v) => set('categories', v)} options={DATA_CATEGORIES.map((c) => ({ value: c, label: DATA_CATEGORY_LABELS[c] }))} />,
          <KeywordField key="q" label="Search entity reference" value={d.q} onChange={(v) => set('q', v)} hint="e.g. INT-004, LV-2027-00012" />,
        ]}
        {...list.listProps}
        activeFilterCount={
          Object.entries(list.applied.filters).filter(([k, v]) => v !== '' && v !== (({ ...AUDIT_FILTERS, ...defaults }) as Record<string, string>)[k]).length
        }
        onExport={async () => {
          try {
            const res = await exportAuditEntriesCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'audit-log', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        exportSensitive
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.key}
        getRowRef={(r) => `${ts(r.occurredAt)} ${entityText(r)}`}
        rowActions={(r) => [{ label: 'View entry', onClick: () => open(r) }]}
        empty={{ title: 'No log entries in this period.' }}
      />

      <ResponsiveDialog
        open={openKey !== null}
        onClose={close}
        title="Log entry"
        maxWidth="md"
        actions={
          <Button variant="outlined" color="inherit" onClick={close}>
            Close
          </Button>
        }
      >
        {!shown ? (
          <Box sx={{ py: 3 }} aria-busy="true">
            {navPending || openKey ? <LinearProgress aria-label="Loading entry" /> : null}
          </Box>
        ) : (
          <Stack spacing={2}>
            <FormGrid>
              <KeyValue label="Timestamp" value={<span className="pret-tnum">{ts(shown.occurredAt)}</span>} />
              <KeyValue label="Source" value={shown.source === 'audit' ? 'Audit trail (data change)' : 'Access log (view / export)'} />
              <KeyValue label="Actor" value={actorText(shown)} />
              <KeyValue label="User type" value={shown.actorUserType ? USER_TYPE_LABELS[shown.actorUserType] : 'System'} />
              <KeyValue label="Action" value={AUDIT_ACTION_LABELS[shown.action]} />
              <KeyValue label="Entity / reference" value={entityText(shown)} />
              <KeyValue label="On behalf of" value={shown.onBehalfEmployeeId ? 'Employee (name after W2-003)' : ''} />
              <KeyValue label="Employee concerned" value={shown.employeeIds.length ? `${shown.employeeIds.length} employee(s)` : ''} />
              <KeyValue label="Data categories" value={catsText(shown)} />
              <KeyValue label="Reason" value={shown.reason} />
              <KeyValue label="IP address" value={shown.ip} />
              <KeyValue label="Device" value={shown.userAgent ? <span title={shown.userAgent}>{deviceLabel(shown.userAgent)}</span> : ''} />
              {shown.recordCount !== null && <KeyValue label="Records" value={String(shown.recordCount)} />}
              {shown.requestId && <KeyValue label="Request reference" value={<span className="pret-tnum">{shown.requestId}</span>} />}
              {shown.userAgent && (
                <FullRow>
                  <KeyValue label="User agent" value={<Typography variant="body2" sx={{ wordBreak: 'break-all' }}>{shown.userAgent}</Typography>} />
                </FullRow>
              )}
            </FormGrid>

            {shown.source === 'audit' && (
              <Box>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" component="h3">
                    Field changes
                  </Typography>
                  {shown.changes.some((c) => c.masked) && !shown.revealed && (
                    <Button variant="text" onClick={() => (revealRun.reset(), setRevealOpen(true))}>
                      Reveal
                    </Button>
                  )}
                </Stack>
                {shown.changes.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No field changes recorded.
                  </Typography>
                ) : (
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table size="small" aria-label="Field changes">
                      <TableHead>
                        <TableRow>
                          <TableCell>Field</TableCell>
                          <TableCell>Before</TableCell>
                          <TableCell>After</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {shown.changes.map((c, i) => (
                          <TableRow key={`${c.field}-${i}`}>
                            <TableCell>{c.field}</TableCell>
                            <TableCell sx={{ wordBreak: 'break-word' }}>{c.before ?? '—'}</TableCell>
                            <TableCell sx={{ wordBreak: 'break-word' }}>{c.after ?? '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
                {shown.revealed && (
                  <Alert severity="info" variant="outlined" sx={{ mt: 1 }}>
                    Values revealed — this view was logged.
                  </Alert>
                )}
              </Box>
            )}
            {shown.source === 'access' && shown.fields.length > 0 && (
              <KeyValue label="Fields viewed" value={shown.fields.join(', ')} />
            )}
            <Typography variant="caption" color="text.secondary">
              Log entries are append-only and cannot be edited or deleted.
            </Typography>
          </Stack>
        )}
      </ResponsiveDialog>

      <ReasonDialog
        open={revealOpen}
        title="Reveal masked values?"
        intro="Viewing is logged."
        fieldLabel="Why do you need to see this?"
        confirmLabel="Reveal"
        tone="primary"
        onClose={() => setRevealOpen(false)}
        onConfirm={async (reason) => {
          if (!shown) return;
          const res = await revealRun.run(() => revealAuditEntry({ source: shown.source, id: shown.id, reason }), { refresh: false });
          if (res?.ok) {
            setRevealed((res as unknown as { entry: AuditEntryDetail }).entry);
            setRevealOpen(false);
          } else if (res && !res.ok) toast.info(res.error);
        }}
      />
    </>
  );
}
