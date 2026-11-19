'use client';

// E3 tabs 1 Overview, 13 Change requests, 14 Notes, 15 Activity log.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import AddIcon from '@mui/icons-material/Add';
import {
  ACTIVITY_EVENT_LABELS,
  ACTIVITY_EVENT_TYPES,
  CR_CATEGORY_LABELS,
  type ActivityParams,
  type ActivityRow,
  type ChangeRequestRow,
  type EmployeeProfile,
  type FieldChangeRow,
  type HrNote,
} from '@/server/contracts/employees';
import { exportEmployeeActivityCsv } from '@/server/actions/employees';
import ListPage, { type ListColumn } from '../../list/ListPage';
import { DateFilter, MultiSelectFilter } from '../../list/FilterFields';
import { downloadServerCsv, useServerList } from '../../list/useServerList';
import { useToast } from '../../ToastProvider';
import DateText from '../../DateText';
import { MiniTable, SectionCard } from '../ui';
import { CompletenessBadge, CrStatusChip, dateOr } from '../labels';
import { ACTIVITY_FILTERS } from '../filters';
import { HrNoteDialog } from './dialogs';
import { formatDateTime } from '@/lib/format';

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export function OverviewTab({ profile, tabHref, leavePlaceholder }: { profile: EmployeeProfile; tabHref: (tab: string) => string; leavePlaceholder: string }) {
  const e = profile.employment;
  const c = profile.completeness;
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Key dates">
          <MiniTable
            caption="Key dates"
            rows={[
              { k: 'Join date', v: dateOr(e.joinDate) },
              { k: 'Probation end', v: dateOr(e.extendedProbationEndDate ?? e.probationEndDate) || '—' },
              { k: 'Confirmation date', v: dateOr(e.confirmationDate) || '—' },
              ...(profile.separation ? [{ k: 'Last working day', v: dateOr(profile.separation.lastWorkingDay) }] : []),
              { k: 'Retirement date', v: dateOr(e.retirementDate) },
            ]}
            getRowId={(r) => r.k}
            columns={[
              { key: 'k', header: 'Date', render: (r) => r.k },
              { key: 'v', header: 'Value', render: (r) => r.v },
            ]}
          />
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title={`Completeness ${c.pct}%`} headerActions={<CompletenessBadge c={c} />}>
          {c.missing.length === 0 ? (
            <Typography color="text.secondary">All required fields are filled.</Typography>
          ) : (
            <List dense disablePadding>
              {c.missing.map((m) => (
                <ListItem key={m.field} disableGutters>
                  <ListItemText
                    primary={
                      <Link component={NextLink} href={tabHref(m.tab)} scroll={false}>
                        {m.label}
                      </Link>
                    }
                    secondary={m.payroll ? 'Needed for payroll (Release 1.1)' : 'Required'}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Upcoming">
          <MiniTable
            caption="Upcoming"
            rows={profile.upcoming}
            getRowId={(u) => `${u.kind}-${u.date}-${u.label}`}
            empty="Nothing upcoming."
            columns={[
              { key: 'd', header: 'Date', render: (u) => dateOr(u.date) },
              { key: 'l', header: 'Item', render: (u) => u.label },
            ]}
          />
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <SectionCard title="Open items">
          <Stack spacing={1}>
            <Typography>
              Change requests open:{' '}
              <Link component={NextLink} href={tabHref('change_requests')} scroll={false}>
                {profile.openItems.changeRequests}
              </Link>
            </Typography>
            <Typography>
              Documents expiring within 30 days:{' '}
              <Link component={NextLink} href={tabHref('documents')} scroll={false}>
                {profile.openItems.documentsExpiringSoon}
              </Link>
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Pending leave and claims appear here from W2-004 / W2-005.
            </Typography>
          </Stack>
        </SectionCard>
      </Grid>
      <Grid size={{ xs: 12 }}>
        <SectionCard title="Leave snapshot">
          <Typography color="text.secondary">{leavePlaceholder}</Typography>
        </SectionCard>
      </Grid>
    </Grid>
  );
}

// ---------------------------------------------------------------------------
// Change requests (this employee)
// ---------------------------------------------------------------------------
export function ChangeRequestsTab({ rows, total }: { rows: ChangeRequestRow[]; total: number }) {
  return (
    <SectionCard title={`Change requests (${total})`} subtitle="Requests raised by this employee. Open one to review it.">
      <MiniTable
        caption="Change requests"
        rows={rows}
        getRowId={(r) => r.id}
        empty="No change requests."
        columns={[
          {
            key: 'n',
            header: 'CR no.',
            render: (r) => (
              <Link component={NextLink} href={`/employees/change-requests/${encodeURIComponent(r.crNo)}`}>
                {r.crNo}
              </Link>
            ),
          },
          { key: 'c', header: 'Category', render: (r) => CR_CATEGORY_LABELS[r.category] },
          { key: 's', header: 'Submitted', render: (r) => formatDateTime(r.submittedAt) },
          { key: 'e', header: 'Effective', render: (r) => dateOr(r.effectiveDate) },
          { key: 'st', header: 'Status', render: (r) => <CrStatusChip status={r.status} /> },
          { key: 'd', header: 'Decided by / at', render: (r) => (r.decidedAt ? `${r.decidedByName ?? ''} ${formatDateTime(r.decidedAt)}` : '—') },
        ]}
      />
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Notes (HR-only)
// ---------------------------------------------------------------------------
function NoteRow({ n, onEdit }: { n: HrNote; onEdit?: () => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [history, setHistory] = React.useState(false);
  const long = n.body.length > 200;
  return (
    <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', py: 1.5 }}>
      <Stack direction="row" spacing={2} alignItems="baseline" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2">{dateOr(n.noteDate)}</Typography>
        <Typography variant="caption" color="text.secondary">
          by {n.createdByName ?? '—'}
        </Typography>
        {n.isEdited && (
          <Link component="button" type="button" variant="caption" onClick={() => setHistory((h) => !h)}>
            Edited ›
          </Link>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {onEdit && (
          <Button size="small" onClick={onEdit}>
            Edit
          </Button>
        )}
      </Stack>
      <Typography sx={{ whiteSpace: 'pre-wrap', mt: 0.5 }}>{long && !expanded ? `${n.body.slice(0, 200)}…` : n.body}</Typography>
      {long && (
        <Link component="button" type="button" variant="body2" onClick={() => setExpanded((x) => !x)}>
          {expanded ? 'Show less' : 'Show more'}
        </Link>
      )}
      <Collapse in={history}>
        <Box sx={{ mt: 1, pl: 2, borderLeft: '3px solid', borderColor: 'divider' }}>
          {n.revisions.map((rv) => (
            <Box key={rv.revision} sx={{ mb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Version {rv.revision} · {rv.editedByName ?? '—'} · {formatDateTime(rv.editedAt)}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {rv.body}
              </Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

export function NotesTab({ employeeId, notes, canAdd }: { employeeId: string; notes: HrNote[]; canAdd: boolean }) {
  const [dialog, setDialog] = React.useState<HrNote | 'new' | null>(null);
  return (
    <SectionCard
      title="HR notes"
      headerActions={
        canAdd && (
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setDialog('new')}>
            Add note
          </Button>
        )
      }
    >
      <Alert severity="info" variant="outlined" sx={{ mb: 1 }}>
        HR-only — never shown to the employee or manager.
      </Alert>
      {notes.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 2 }}>
          No notes yet.
        </Typography>
      ) : (
        notes.map((n) => <NoteRow key={n.id} n={n} onEdit={canAdd ? () => setDialog(n) : undefined} />)
      )}
      <HrNoteDialog open={dialog !== null} onClose={() => setDialog(null)} employeeId={employeeId} note={dialog === 'new' ? null : dialog} />
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Activity log (F-EMP-28) + field changes (F-EMP-21)
// ---------------------------------------------------------------------------
type ActivityItem = ActivityRow | FieldChangeRow;

export function ActivityTab({ view, rows, total, params, canExport }: { view: 'events' | 'fields'; rows: ActivityItem[]; total: number; params: ActivityParams; canExport: boolean }) {
  const list = useServerList({ filters: ACTIVITY_FILTERS, sort: { key: 'occurredAt', direction: 'desc' }, preserve: ['tab'] });
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const d = list.draft;
  const set = list.setDraftField;

  const eventCols: ListColumn<ActivityRow>[] = [
    { key: 'occurredAt', header: 'Date / time', kind: 'date', sortable: false, value: (x) => formatDateTime(x.occurredAt), render: (x) => <DateText value={x.occurredAt} mode="datetime" /> },
    {
      key: 'event',
      header: 'Event',
      sortable: false,
      minWidth: 220,
      value: (x) => x.event,
      render: (x) =>
        x.link ? (
          <Link component={NextLink} href={x.link}>
            {x.event}
          </Link>
        ) : (
          x.event
        ),
    },
    { key: 'type', header: 'Type', sortable: false, value: (x) => ACTIVITY_EVENT_LABELS[x.eventType] },
    { key: 'by', header: 'By', sortable: false, value: (x) => `${x.actorName ?? 'System'}${x.onBehalf ? ' (on behalf)' : ''}` },
  ];
  const fieldCols: ListColumn<FieldChangeRow>[] = [
    { key: 'occurredAt', header: 'At', kind: 'date', sortable: false, value: (x) => formatDateTime(x.occurredAt), render: (x) => <DateText value={x.occurredAt} mode="datetime" /> },
    { key: 'field', header: 'Field', sortable: false, value: (x) => x.label },
    { key: 'before', header: 'Before', sortable: false, value: (x) => x.before ?? '' },
    { key: 'after', header: 'After', sortable: false, value: (x) => `${x.after ?? ''}${x.masked ? ' (masked)' : ''}` },
    { key: 'by', header: 'Changed by', sortable: false, value: (x) => x.actorName ?? 'System' },
    { key: 'source', header: 'Source', sortable: false, value: (x) => x.source },
  ];

  return (
    <Stack spacing={2}>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={view}
        onChange={(_e, v: string | null) => {
          if (!v) return;
          const next = new URLSearchParams(searchParams?.toString() ?? '');
          next.set('view', v);
          for (const k of ['page', 'sort', 'dir']) next.delete(k);
          router.replace(`${pathname}?${next.toString()}`, { scroll: false });
        }}
        aria-label="Activity view"
      >
        <ToggleButton value="events">Timeline</ToggleButton>
        <ToggleButton value="fields">Field changes</ToggleButton>
      </ToggleButtonGroup>
      {view === 'events' ? (
        <ListPage<ActivityRow>
          itemName={{ singular: 'event', plural: 'events' }}
          filters={[
            <MultiSelectFilter key="t" label="Event type" value={d.eventTypes} onChange={(v) => set('eventTypes', v)} options={ACTIVITY_EVENT_TYPES.map((t) => ({ value: t, label: ACTIVITY_EVENT_LABELS[t] }))} />,
            <DateFilter key="f" label="From" value={d.from} onChange={(v) => set('from', v)} />,
            <DateFilter key="to" label="To" value={d.to} onChange={(v) => set('to', v)} />,
          ]}
          {...list.listProps}
          onExport={canExport ? () => exportActivity(params, toast) : undefined}
          exportSensitive
          columns={eventCols}
          rows={rows as ActivityRow[]}
          total={total}
          getRowId={(x) => x.key}
          empty={{ title: 'No activity yet.' }}
        />
      ) : (
        <ListPage<FieldChangeRow>
          itemName={{ singular: 'field change', plural: 'field changes' }}
          filters={[
            <MultiSelectFilter key="t" label="Area" value={d.eventTypes} onChange={(v) => set('eventTypes', v)} options={ACTIVITY_EVENT_TYPES.map((t) => ({ value: t, label: ACTIVITY_EVENT_LABELS[t] }))} />,
            <DateFilter key="f" label="From" value={d.from} onChange={(v) => set('from', v)} />,
            <DateFilter key="to" label="To" value={d.to} onChange={(v) => set('to', v)} />,
          ]}
          {...list.listProps}
          onExport={canExport ? () => exportActivity(params, toast) : undefined}
          exportSensitive
          columns={fieldCols}
          rows={rows as FieldChangeRow[]}
          total={total}
          getRowId={(x) => x.key}
          empty={{ title: 'No field changes recorded.' }}
        />
      )}
    </Stack>
  );
}

async function exportActivity(params: ActivityParams, toast: ReturnType<typeof useToast>) {
  try {
    const res = await exportEmployeeActivityCsv(params);
    if (res.ok) downloadServerCsv(res.filename || 'activity', res.content);
    else toast.info(res.error);
  } catch {
    toast.info('Export failed. Please try again.');
  }
}
