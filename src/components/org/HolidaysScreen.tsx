'use client';

// O7 · Public holidays — S-OR-07 · /organisation/holidays · F-ORG-07–10 · US-ORG-005–008, US-LEAVE-041.
// Header: Year selector · status (Draft / Published) · other years' status · PUBLISH YEAR.
// Compliance check card per state (BR-ORG-20): 5 compulsory present (block publish if missing),
// ≥ 11 paid holidays (warning to acknowledge).
// Filters: search name · State (multi) · Type (multi) · Observed · View (List / Calendar).
// Actions: EXPORT .CSV · IMPORT (→ S-IM-02 T10) · COPY TO NEXT YEAR · ADD NEW HOLIDAY · CLEAR · SEARCH.
// Columns: Date › · Day · Name · Type · States · EA compulsory · Observed · Half day ·
// ⋮ Edit / Delete (Draft) / Deactivate (Published). Replacement rows are system-generated (🔒, PH9 shown).
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import LockIcon from '@mui/icons-material/Lock';
import PublishOutlinedIcon from '@mui/icons-material/PublishOutlined';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  ENTERABLE_HOLIDAY_TYPES,
  type CalendarStatus,
  type CompulsoryHoliday,
  type CopyHolidaysResult,
  type CopyToNextYearPreview,
  type HolidayDetail,
  type HolidayListParams,
  type HolidayRow,
  type HolidayYearSummary,
  type MyState,
} from '@/server/contracts/org';
import {
  copyHolidaysToNextYear,
  createHoliday,
  deleteHoliday,
  exportHolidaysCsv,
  publishHolidayYear,
  setHolidayActive,
  updateHoliday,
} from '@/server/actions/org';
import ListPage, { type ListColumn, type RowAction } from '../list/ListPage';
import { useServerList, downloadServerCsv } from '../list/useServerList';
import { KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import StatusChip from '../StatusChip';
import DateText from '../DateText';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import FormDialog from '../forms/FormDialog';
import ErrorSummary from '../forms/ErrorSummary';
import { CheckboxInput, DateInput, FormGrid, FullRow, KeyValue, MultiSelectInput, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import { useToast } from '../ToastProvider';
import HolidayCalendarView from './HolidayCalendarView';
import { HOLIDAY_FILTERS } from './filters';
import { COMPULSORY_HOLIDAY_LABELS, HOLIDAY_TYPE_LABELS, MY_STATE_LABELS, STATE_OPTIONS, optionsOf, stateLabel, yesNo } from './labels';
import { stampsMeta } from './common';
import { formatDate } from '@/lib/format';

type FormValue = {
  holidayDate: string;
  name: string;
  holidayType: string;
  allStates: boolean;
  states: string[];
  compulsory: string;
  isObserved: boolean;
  isHalfDay: boolean;
  remarks: string;
};

const ALL_STATES = STATE_OPTIONS.map((s) => s.value);
const statusLabel = (s: CalendarStatus) => (s === 'published' ? ('Published' as const) : ('Draft' as const));
const statesText = (r: Pick<HolidayRow, 'allStates' | 'states'>) => (r.allStates ? 'All states' : r.states.map((s) => MY_STATE_LABELS[s]).join(', '));

export type HolidaysScreenProps = {
  year: number;
  years: { year: number; status: CalendarStatus }[];
  summary: HolidayYearSummary;
  rows: HolidayRow[];
  total: number;
  params: HolidayListParams;
  view: 'list' | 'calendar';
  detail: HolidayDetail | null;
  copyPreview: CopyToNextYearPreview | null;
};

export default function HolidaysScreen({ year, years, summary, rows, total, params, view, detail, copyPreview }: HolidaysScreenProps) {
  const list = useServerList({ filters: HOLIDAY_FILTERS, sort: { key: 'date', direction: 'asc' } });
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const toast = useToast();
  const [navPending, startNav] = React.useTransition();
  const published = summary.status === 'published';

  const setParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const sp = new URLSearchParams(search?.toString() ?? '');
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      startNav(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [router, pathname, search],
  );

  // ---- Add / edit dialog ----------------------------------------------------
  const runner = useActionRunner();
  const [dialog, setDialog] = React.useState<{ row: HolidayRow | null } | null>(null);
  const [value, setValue] = React.useState<FormValue | null>(null);
  const [initial, setInitial] = React.useState('');
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});
  const [confirmPublishedChange, setConfirmPublishedChange] = React.useState(false);

  const toForm = (r: HolidayRow): FormValue => ({
    holidayDate: r.holidayDate,
    name: r.name,
    holidayType: r.holidayType,
    allStates: r.allStates,
    states: r.allStates ? [] : r.states,
    compulsory: r.compulsory ?? '',
    isObserved: r.isObserved,
    isHalfDay: r.isHalfDay,
    remarks: r.remarks ?? '',
  });
  const openNew = () => {
    const v: FormValue = { holidayDate: '', name: '', holidayType: '', allStates: false, states: [], compulsory: '', isObserved: true, isHalfDay: false, remarks: '' };
    runner.reset();
    setLocalErrors({});
    setValue(v);
    setInitial(JSON.stringify(v));
    setDialog({ row: null });
  };
  const openRow = (r: HolidayRow) => {
    const v = toForm(r);
    runner.reset();
    setLocalErrors({});
    setValue(v);
    setInitial(JSON.stringify(v));
    setDialog({ row: r });
    if (r.kind === 'holiday') setParams({ edit: r.id });
  };
  const closeDialog = () => {
    setDialog(null);
    if (search?.get('edit')) setParams({ edit: null });
  };
  // Deep link ?edit=<id>
  React.useEffect(() => {
    if (detail && !dialog) openRow(detail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail?.id]);

  const validate = (v: FormValue) => {
    const e: Record<string, string> = {};
    if (!v.holidayDate) e.holidayDate = 'Enter a date.';
    else if (Number(v.holidayDate.slice(0, 4)) !== year) e.holidayDate = 'The date must be within the selected year.';
    if (!v.name.trim()) e.name = 'Name is required.';
    if (!v.holidayType) e.holidayType = 'Select a type.';
    if (!v.allStates && v.states.length === 0) e.states = 'Select at least one state (or All states).';
    return e;
  };

  const doSave = async () => {
    if (!value || !dialog) return;
    const row = dialog.row;
    const fields = {
      holidayDate: value.holidayDate,
      name: value.name,
      holidayType: value.holidayType as (typeof ENTERABLE_HOLIDAY_TYPES)[number],
      states: (value.allStates ? ALL_STATES : value.states) as MyState[],
      compulsory: (value.compulsory || null) as CompulsoryHoliday | null,
      isObserved: value.isObserved,
      isHalfDay: value.isHalfDay,
      remarks: value.remarks,
    };
    const res = await runner.run(
      () => (row ? updateHoliday({ ...fields, id: row.id, isActive: row.isActive }) : createHoliday({ ...fields, year })),
      { success: `Holiday ${value.name.trim()} on ${formatDate(value.holidayDate)} saved.` },
    );
    if (res?.ok) {
      const n = (res as unknown as { affectedLeaveApplications?: number }).affectedLeaveApplications ?? 0;
      if (n > 0) toast.info(`${n} approved/pending application${n === 1 ? '' : 's'} will be recounted and employees notified.`);
      closeDialog();
    }
  };
  const submit = async () => {
    if (!value) return;
    const errs = validate(value);
    setLocalErrors(errs);
    if (Object.keys(errs).length) return;
    if (published) setConfirmPublishedChange(true);
    else await doSave();
  };

  // ---- Row status actions (delete draft / deactivate published) --------------
  const statusRunner = useActionRunner();
  const [statusAction, setStatusAction] = React.useState<{ row: HolidayRow; kind: 'delete' | 'deactivate' | 'reactivate' } | null>(null);

  // ---- Publish ----------------------------------------------------------------
  const publishRunner = useActionRunner();
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [ackWarnings, setAckWarnings] = React.useState<string[] | null>(null);
  const [ack, setAck] = React.useState(false);
  const publish = async (acknowledge: boolean) => {
    const res = await publishRunner.run(() => publishHolidayYear({ year, acknowledgeWarnings: acknowledge }), {
      success: `${year} calendar published.`,
    });
    if (res?.ok) {
      setPublishOpen(false);
      setAckWarnings(null);
      setAck(false);
    } else if (res && !res.ok && res.fieldErrors?.acknowledgeWarnings) {
      setAckWarnings(res.fieldErrors.acknowledgeWarnings.split('\n').filter(Boolean));
      publishRunner.reset();
    }
  };

  // ---- Copy to next year --------------------------------------------------------
  const copyRunner = useActionRunner();
  const [copyOpen, setCopyOpen] = React.useState(false);
  const [copySel, setCopySel] = React.useState<string[]>([]);
  const [copyResult, setCopyResult] = React.useState<CopyHolidaysResult | null>(null);
  React.useEffect(() => {
    if (copyPreview && copyPreview.fromYear === year) setCopySel(copyPreview.items.filter((i) => i.suggested && !i.alreadyExists).map((i) => i.id));
  }, [copyPreview, year]);
  const openCopy = () => {
    copyRunner.reset();
    setCopyResult(null);
    setCopyOpen(true);
    if (!copyPreview || copyPreview.fromYear !== year) setParams({ copy: '1' });
  };
  const closeCopy = () => {
    setCopyOpen(false);
    if (search?.get('copy')) setParams({ copy: null });
  };

  // ---- Export -----------------------------------------------------------------
  const exportCsv = async () => {
    try {
      const res = await exportHolidaysCsv(params);
      if (res.ok) downloadServerCsv(res.filename || `public-holidays-${year}`, res.content);
      else toast.info(res.error);
    } catch {
      toast.info('Export failed. Please try again.');
    }
  };

  // ---- Columns -------------------------------------------------------------------
  const columns: ListColumn<HolidayRow>[] = [
    {
      key: 'date',
      header: 'Date',
      kind: 'date',
      value: (r) => formatDate(r.holidayDate),
      render: (r) => (
        <Link component="button" type="button" onClick={() => openRow(r)} sx={{ fontWeight: 600 }} className="pret-tnum">
          {formatDate(r.holidayDate)}
        </Link>
      ),
    },
    { key: 'day', header: 'Day', sortable: false, value: (r) => r.dayOfWeek },
    {
      key: 'name',
      header: 'Name',
      minWidth: 200,
      value: (r) => r.name,
      render: (r) => (
        <span>
          {r.kind === 'replacement' && <LockIcon fontSize="inherit" aria-label="System-generated" sx={{ verticalAlign: 'middle', mr: 0.5, color: 'text.secondary' }} />}
          {r.name}
          {r.kind === 'replacement' && r.patternName ? (
            <Typography component="span" variant="caption" color="text.secondary">
              {' '}
              · {r.patternName}
            </Typography>
          ) : null}
          {!r.isActive && (
            <Typography component="span" variant="caption" color="text.secondary">
              {' '}
              (deactivated)
            </Typography>
          )}
        </span>
      ),
    },
    { key: 'type', header: 'Type', sortable: false, value: (r) => HOLIDAY_TYPE_LABELS[r.holidayType] },
    { key: 'states', header: 'States', sortable: false, minWidth: 160, value: (r) => statesText(r) },
    { key: 'compulsory', header: 'EA compulsory', sortable: false, priority: 'low', value: (r) => (r.compulsory ? COMPULSORY_HOLIDAY_LABELS[r.compulsory] : '') },
    { key: 'observed', header: 'Observed', sortable: false, value: (r) => yesNo(r.isObserved) },
    { key: 'half', header: 'Half day', sortable: false, priority: 'low', value: (r) => (r.isHalfDay ? 'Yes' : '') },
  ];

  const rowActions = (r: HolidayRow): RowAction[] => {
    if (r.kind === 'replacement') return [{ label: 'View', onClick: () => openRow(r) }];
    const a: RowAction[] = [{ label: 'Edit', onClick: () => openRow(r) }];
    if (!published) a.push({ label: 'Delete', danger: true, onClick: () => setStatusAction({ row: r, kind: 'delete' }) });
    else if (r.isActive) a.push({ label: 'Deactivate', danger: true, onClick: () => setStatusAction({ row: r, kind: 'deactivate' }) });
    else a.push({ label: 'Reactivate', onClick: () => setStatusAction({ row: r, kind: 'reactivate' }) });
    return a;
  };

  // ---- Year header ---------------------------------------------------------------
  const nowYear = new Date().getFullYear();
  const yearOptions = Array.from(new Set([...years.map((y) => y.year), nowYear - 1, nowYear, nowYear + 1, year])).sort((a, b) => a - b);
  const otherYears = years.filter((y) => y.year !== year);

  const errors = { ...runner.fieldErrors, ...localErrors };
  const replacement = dialog?.row?.kind === 'replacement';
  const blocking = summary.checks.filter((c) => c.blocking);

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                select
                label="Year *"
                value={String(year)}
                onChange={(e) => setParams({ year: e.target.value, page: null, edit: null, copy: null })}
                sx={{ minWidth: 120 }}
              >
                {yearOptions.map((y) => (
                  <MenuItem key={y} value={String(y)}>
                    {y}
                  </MenuItem>
                ))}
              </TextField>
              <StatusChip set="phCalendar" value={statusLabel(summary.status)} />
              {otherYears.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {otherYears.map((y) => `${y.year} ${statusLabel(y.status)}`).join(' · ')}
                </Typography>
              )}
              {published && summary.publishedAt && (
                <Typography variant="body2" color="text.secondary">
                  Published by {summary.publishedByName ?? 'System'} at {formatDate(summary.publishedAt)}
                </Typography>
              )}
            </Stack>
            {!published && (
              <Tooltip title={summary.canPublish ? '' : blocking.length ? 'Compulsory holidays are missing — see the checks below.' : 'Add holidays first.'}>
                <span>
                  <Button variant="contained" color="success" startIcon={<PublishOutlinedIcon />} onClick={() => setPublishOpen(true)} disabled={!summary.canPublish}>
                    Publish year
                  </Button>
                </span>
              </Tooltip>
            )}
          </Stack>
          {navPending && <LinearProgress aria-label="Loading" sx={{ mt: 2 }} />}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Checks
          </Typography>
          {summary.checks.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No active work locations yet — add a work location to check its state calendar.
            </Typography>
          ) : (
            <Grid container spacing={1}>
              {summary.checks.map((c) => (
                <Grid key={c.state} size={{ xs: 12, md: 6 }}>
                  <Stack direction="row" spacing={1} alignItems="flex-start">
                    {c.blocking || c.warning ? (
                      <WarningAmberIcon fontSize="small" sx={{ color: c.blocking ? '#B42318' : '#B45309', mt: 0.25 }} aria-hidden />
                    ) : (
                      <CheckCircleOutlineIcon fontSize="small" sx={{ color: '#198754', mt: 0.25 }} aria-hidden />
                    )}
                    <Typography variant="body2">
                      <strong>{stateLabel(c.state)}</strong> · {c.compulsoryPresent.length} of 5 compulsory · {c.paidHolidayCount} paid
                      {c.compulsoryMissing.length > 0 && (
                        <Box component="span" sx={{ color: '#B42318' }}>
                          {' '}
                          — missing {c.compulsoryMissing.map((m) => COMPULSORY_HOLIDAY_LABELS[m]).join(', ')} (publishing blocked)
                        </Box>
                      )}
                      {c.paidHolidayCount < 11 && (
                        <Box component="span" sx={{ color: '#7A4100' }}>
                          {' '}
                          — fewer than 11 paid holidays
                        </Box>
                      )}
                    </Typography>
                  </Stack>
                </Grid>
              ))}
            </Grid>
          )}
        </CardContent>
      </Card>

      <ListPage<HolidayRow>
        itemName={{ singular: 'holiday', plural: 'holidays' }}
        filters={[
          <KeywordField key="q" value={list.draft.q} onChange={(v) => list.setDraftField('q', v)} hint="Searches holiday name" />,
          <MultiSelectFilter key="states" label="State" value={list.draft.states} onChange={(v) => list.setDraftField('states', v)} options={STATE_OPTIONS} />,
          <MultiSelectFilter key="types" label="Type" value={list.draft.types} onChange={(v) => list.setDraftField('types', v)} options={optionsOf(HOLIDAY_TYPE_LABELS)} />,
          <SelectFilter
            key="observed"
            label="Observed"
            value={list.draft.observed}
            onChange={(v) => list.setDraftField('observed', v)}
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
          />,
          <ToggleButtonGroup
            key="view"
            exclusive
            size="small"
            value={view}
            onChange={(_e, v) => v && setParams({ view: v === 'list' ? null : v, page: null })}
            aria-label="View"
          >
            <ToggleButton value="list">List</ToggleButton>
            <ToggleButton value="calendar">Calendar</ToggleButton>
          </ToggleButtonGroup>,
        ]}
        {...list.listProps}
        activeFilterCount={[list.applied.filters.q, list.applied.filters.states, list.applied.filters.types, list.applied.filters.observed].filter(Boolean).length}
        onExport={exportCsv}
        extraActions={
          <>
            <Button variant="outlined" color="inherit" startIcon={<UploadFileOutlinedIcon />} component={NextLink} href="/imports/new?template=T10">
              Import
            </Button>
            <Button variant="outlined" color="inherit" startIcon={<ContentCopyOutlinedIcon />} onClick={openCopy}>
              Copy to next year
            </Button>
          </>
        }
        addNew={{ label: 'Add new holiday', onClick: openNew }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => `${r.kind}:${r.id}`}
        getRowRef={(r) => `${formatDate(r.holidayDate)} ${r.name}`}
        rowActions={rowActions}
        empty={{ title: `No holidays for ${year} yet.`, helper: 'Add holidays from the gazette, import them, or copy fixed-date holidays from the previous year.' }}
        bodyOverride={
          view === 'calendar' ? (
        <HolidayCalendarView
          year={year}
          holidays={rows.map((r) => ({
            id: r.id,
            date: r.holidayDate,
            name: r.name,
            replacement: r.kind === 'replacement',
            observed: r.isObserved,
            halfDay: r.isHalfDay,
          }))}
          onSelect={(id) => {
            const r = rows.find((x) => x.id === id && x.kind === 'holiday');
            if (r) openRow(r);
          }}
        />
          ) : undefined
        }
      />

      {/* Add / edit */}
      <FormDialog
        open={Boolean(dialog)}
        title={replacement ? 'Replacement holiday' : dialog?.row ? `Edit holiday ${dialog.row.name}` : `New holiday (${year})`}
        onClose={closeDialog}
        onSubmit={submit}
        saving={runner.saving}
        error={runner.error}
        fieldErrors={errors}
        fieldLabels={{ holidayDate: 'Date', name: 'Name', holidayType: 'Type', states: 'Applicable states', compulsory: 'EA compulsory holiday', remarks: 'Remarks' }}
        dirty={value ? JSON.stringify(value) !== initial : false}
        meta={detail && dialog?.row && detail.id === dialog.row.id ? stampsMeta(detail) : null}
        readOnly={replacement}
        maxWidth="md"
      >
        {dialog && value && replacement && dialog.row && (
          <FormGrid>
            <KeyValue label="Date" value={<DateText value={dialog.row.holidayDate} />} />
            <KeyValue label="Name" value={dialog.row.name} />
            <KeyValue label="Source holiday" value={dialog.row.sourceHolidayName} />
            <KeyValue label="Working pattern" value={dialog.row.patternName} />
            <KeyValue label="States" value={statesText(dialog.row)} />
            <FullRow>
              <Alert severity="info" variant="outlined" icon={<LockIcon fontSize="inherit" />}>
                Replacement holidays are created by the system when an observed holiday falls on a rest day (BR-ORG-21). Edit the source holiday
                instead.
              </Alert>
            </FullRow>
          </FormGrid>
        )}
        {dialog && value && !replacement && (
          <FormGrid>
            <TextInput label="Year" value={String(year)} onChange={() => undefined} locked="Set by the year selector" />
            <DateInput
              label="Date"
              required
              value={value.holidayDate}
              onChange={(v) => setValue({ ...value, holidayDate: v })}
              minDate={`${year}-01-01`}
              maxDate={`${year}-12-31`}
              error={errors.holidayDate}
            />
            <TextInput full label="Name" required value={value.name} onChange={(v) => setValue({ ...value, name: v })} maxLength={100} error={errors.name} helper='e.g. "Hari Kebangsaan" / "National Day"' />
            <SelectInput
              label="Type"
              required
              value={value.holidayType}
              onChange={(v) => setValue({ ...value, holidayType: v })}
              options={ENTERABLE_HOLIDAY_TYPES.map((t) => ({ value: t, label: HOLIDAY_TYPE_LABELS[t] }))}
              error={errors.holidayType}
            />
            <SelectInput
              label="EA compulsory holiday"
              value={value.compulsory}
              onChange={(v) => setValue({ ...value, compulsory: v })}
              options={optionsOf(COMPULSORY_HOLIDAY_LABELS)}
              emptyLabel="—"
              error={errors.compulsory}
            />
            <FullRow>
              <Stack spacing={1}>
                <CheckboxInput label="All states" checked={value.allStates} onChange={(v) => setValue({ ...value, allStates: v, states: v ? [] : value.states })} />
                {!value.allStates && (
                  <MultiSelectInput
                    label="Applicable states"
                    required
                    value={value.states}
                    onChange={(v) => setValue({ ...value, states: v })}
                    options={STATE_OPTIONS}
                    error={errors.states}
                    limitTags={6}
                  />
                )}
              </Stack>
            </FullRow>
            <SwitchInput label="Observed by Interact *" checked={value.isObserved} onChange={(v) => setValue({ ...value, isObserved: v })} helper="Default Yes (Q15)" />
            <SwitchInput label="Half day" checked={value.isHalfDay} onChange={(v) => setValue({ ...value, isHalfDay: v })} helper="e.g. company half day before a festival" />
            <TextInput full label="Remarks" value={value.remarks} onChange={(v) => setValue({ ...value, remarks: v })} maxLength={200} multiline minRows={2} error={errors.remarks} />
            {published && (
              <FullRow>
                <Alert severity="warning" variant="outlined">
                  {year} is published. Approved and pending leave applications on this date will be recounted and employees notified.
                </Alert>
              </FullRow>
            )}
          </FormGrid>
        )}
      </FormDialog>

      <ConfirmDialog
        open={confirmPublishedChange}
        title={`Change the published ${year} calendar?`}
        body="Approved and pending leave applications on this date will be recounted and employees notified."
        confirmLabel="Confirm"
        tone="warning"
        onClose={() => setConfirmPublishedChange(false)}
        onConfirm={async () => {
          setConfirmPublishedChange(false);
          await doSave();
        }}
      />

      {/* Delete (draft) / Deactivate (published) */}
      <ConfirmDialog
        open={Boolean(statusAction)}
        title={
          statusAction
            ? `${statusAction.kind === 'delete' ? 'Delete' : statusAction.kind === 'deactivate' ? 'Deactivate' : 'Reactivate'} ${statusAction.row.name} (${formatDate(statusAction.row.holidayDate)})?`
            : ''
        }
        body={
          statusAction ? (
            <>
              {statusRunner.error && <ErrorSummary error={statusRunner.error} title="Not changed" />}
              {statusAction.kind === 'delete'
                ? 'The holiday is removed from the draft calendar. This cannot be undone.'
                : `${year} is published. Approved and pending leave applications on this date will be recounted and employees notified.`}
            </>
          ) : null
        }
        confirmLabel={statusAction?.kind === 'delete' ? 'Delete' : statusAction?.kind === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        destructive={statusAction?.kind !== 'reactivate'}
        onClose={() => {
          statusRunner.reset();
          setStatusAction(null);
        }}
        onConfirm={async () => {
          if (!statusAction) return;
          const { row, kind } = statusAction;
          const res = await statusRunner.run(
            () => (kind === 'delete' ? deleteHoliday({ id: row.id }) : setHolidayActive({ id: row.id, isActive: kind === 'reactivate' })),
            { success: `${row.name} ${kind === 'delete' ? 'deleted' : kind === 'deactivate' ? 'deactivated' : 'reactivated'}.` },
          );
          if (res?.ok) {
            const n = (res as unknown as { affectedLeaveApplications?: number }).affectedLeaveApplications ?? 0;
            if (n > 0) toast.info(`${n} approved/pending application${n === 1 ? '' : 's'} will be recounted and employees notified.`);
            setStatusAction(null);
          }
        }}
      />

      {/* Publish */}
      <ResponsiveDialog
        open={publishOpen}
        onClose={() => !publishRunner.saving && (setPublishOpen(false), setAckWarnings(null), setAck(false))}
        title={`Publish ${year}?`}
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => (setPublishOpen(false), setAckWarnings(null), setAck(false))} disabled={publishRunner.saving}>
              Cancel
            </Button>
            <Button
              variant="contained"
              color="success"
              loading={publishRunner.saving}
              disabled={Boolean(ackWarnings) && !ack}
              onClick={() => publish(Boolean(ackWarnings))}
            >
              Publish
            </Button>
          </>
        }
      >
        <Typography>Leave counting will use it and employees will see it.</Typography>
        {publishRunner.error && <Box sx={{ mt: 2 }}><ErrorSummary error={publishRunner.error} title="Can't publish yet" /></Box>}
        {ackWarnings && (
          <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
            <AlertTitle>Please review</AlertTitle>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {ackWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <FormControlLabel control={<Checkbox checked={ack} onChange={(e) => setAck(e.target.checked)} />} label="I understand" />
          </Alert>
        )}
      </ResponsiveDialog>

      {/* Copy to next year (BR-ORG-24) */}
      <ResponsiveDialog
        open={copyOpen}
        onClose={() => !copyRunner.saving && closeCopy()}
        title={copyResult ? `Copied to ${copyResult.toYear}` : `Copy holidays from ${year} to ${year + 1}`}
        maxWidth="md"
        actions={
          copyResult ? (
            <>
              <Button variant="outlined" color="inherit" onClick={closeCopy}>
                Close
              </Button>
              <Button
                variant="contained"
                onClick={() => {
                  closeCopy();
                  setParams({ year: String(copyResult.toYear), page: null, copy: null });
                }}
              >
                Go to {copyResult.toYear}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outlined" color="inherit" onClick={closeCopy} disabled={copyRunner.saving}>
                Cancel
              </Button>
              <Button
                variant="contained"
                loading={copyRunner.saving}
                disabled={copySel.length === 0 || !copyPreview}
                onClick={async () => {
                  const res = await copyRunner.run(() => copyHolidaysToNextYear({ fromYear: year, holidayIds: copySel }), {
                    success: `Holidays copied to ${year + 1} as Draft.`,
                  });
                  if (res?.ok) setCopyResult(res as unknown as CopyHolidaysResult);
                }}
              >
                Copy {copySel.length} as draft
              </Button>
            </>
          )
        }
      >
        {copyRunner.error && <ErrorSummary error={copyRunner.error} title="Not copied" />}
        {copyResult ? (
          <Stack spacing={2}>
            <Typography>
              {copyResult.created} holiday{copyResult.created === 1 ? '' : 's'} created as Draft in {copyResult.toYear}; {copyResult.skipped} skipped (already there).
            </Typography>
            {copyResult.toEnterFromGazette.length > 0 && (
              <Alert severity="info" variant="outlined">
                <AlertTitle>To enter from the gazette</AlertTitle>
                Variable-date holidays (e.g. Hari Raya, CNY, Deepavali, Wesak, Thaipusam, Agong&apos;s / Ruler&apos;s birthday) must be entered from the
                official gazette:
                <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                  {copyResult.toEnterFromGazette.map((g) => (
                    <li key={g.name + g.holidayDate}>
                      {g.name} (was {formatDate(g.holidayDate)})
                    </li>
                  ))}
                </ul>
              </Alert>
            )}
          </Stack>
        ) : !copyPreview || copyPreview.fromYear !== year ? (
          <Box sx={{ py: 3 }}>
            <LinearProgress aria-label="Loading holidays" />
          </Box>
        ) : copyPreview.items.length === 0 ? (
          <Typography>There are no holidays in {year} to copy.</Typography>
        ) : (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">
              Fixed-date holidays are pre-ticked. Variable-date holidays must be entered from the gazette. {copyPreview.toYear} is{' '}
              {copyPreview.toYearStatus === 'published' ? 'published — copied holidays recount leave' : 'a draft'}.
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label="Holidays to copy">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">
                      <Checkbox
                        checked={copySel.length > 0 && copySel.length === copyPreview.items.filter((i) => !i.alreadyExists).length}
                        indeterminate={copySel.length > 0 && copySel.length < copyPreview.items.filter((i) => !i.alreadyExists).length}
                        onChange={(e) => setCopySel(e.target.checked ? copyPreview.items.filter((i) => !i.alreadyExists).map((i) => i.id) : [])}
                        slotProps={{ input: { 'aria-label': 'Select all' } }}
                      />
                    </TableCell>
                    <TableCell>Date</TableCell>
                    <TableCell>Name</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>New date</TableCell>
                    <TableCell>Note</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {copyPreview.items.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={copySel.includes(i.id)}
                          disabled={i.alreadyExists}
                          onChange={(e) => setCopySel((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))}
                          slotProps={{ input: { 'aria-label': `Copy ${i.name}` } }}
                        />
                      </TableCell>
                      <TableCell>
                        <DateText value={i.holidayDate} />
                      </TableCell>
                      <TableCell>{i.name}</TableCell>
                      <TableCell>{HOLIDAY_TYPE_LABELS[i.holidayType]}</TableCell>
                      <TableCell>
                        <DateText value={i.targetDate} />
                      </TableCell>
                      <TableCell>{i.alreadyExists ? 'Already in next year' : i.suggested ? 'Fixed date' : 'Variable date — check the gazette'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        )}
      </ResponsiveDialog>
    </Stack>
  );
}
