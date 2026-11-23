'use client';

// P11 · S-PT-11 · /my/holidays · F-PRT-10 · US-PORTAL-010
// Header "Public holidays — {state of my work location} · {year ▾}" · List / Calendar view.
// List: Date · Day · Name · Type (National / State / Replacement / Company / Special declared) · Half day.
// Search: name. Filters: Year · Type. EXPORT .CSV. Only published calendars (BR-ORG-25);
// unpublished year → "The {year} calendar has not been published yet."
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { HOLIDAY_TYPES, type HolidayType, type MyHolidayRow, type MyHolidaysPage, type MyHolidaysParams } from '@/server/contracts/portal';
import { exportMyHolidaysCsv } from '@/server/actions/portal';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField, MultiSelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import DateText from '../DateText';
import EmptyState from '../EmptyState';
import HolidayCalendarView from '../org/HolidayCalendarView';
import { useToast } from '../ToastProvider';
import { formatDate } from '@/lib/format';
import { ToneChip, useSetParams } from './common';

export const MY_HOLIDAY_FILTERS = { q: '', types: '' };

/** P11 wireframe wording for the type column (the admin labels say "gazetted" / "(auto)"). */
export const P11_TYPE_LABELS: Record<HolidayType, string> = {
  national: 'National',
  state: 'State',
  replacement: 'Replacement',
  company: 'Company',
  special: 'Special declared',
};
const TYPE_TONE: Record<HolidayType, string> = { national: 'indigo', state: 'info', replacement: 'grey', company: 'success', special: 'warning' };

export default function MyHolidays({ data, params, view }: { data: MyHolidaysPage; params: MyHolidaysParams; view: 'list' | 'calendar' }) {
  const list = useServerList({ filters: MY_HOLIDAY_FILTERS, sort: { key: 'date', direction: 'asc' }, preserve: ['year', 'view'] });
  const { set, pending } = useSetParams();
  const toast = useToast();
  const d = list.draft;

  const columns: ListColumn<MyHolidayRow>[] = [
    { key: 'date', header: 'Date', kind: 'date', value: (r) => formatDate(r.date), render: (r) => <DateText value={r.date} /> },
    { key: 'day', header: 'Day', sortable: false, value: (r) => r.day },
    {
      key: 'name',
      header: 'Name',
      value: (r) => r.name,
      render: (r) => (
        <span>
          {r.name}
          {r.kind === 'replacement' && r.replacesName && (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Replaces {r.replacesName}
              {r.replacesDate ? ` (${formatDate(r.replacesDate)})` : ''}
            </Typography>
          )}
        </span>
      ),
    },
    { key: 'type', header: 'Type', kind: 'status', sortable: false, value: (r) => P11_TYPE_LABELS[r.type], render: (r) => <ToneChip label={P11_TYPE_LABELS[r.type]} tone={TYPE_TONE[r.type]} /> },
    { key: 'halfDay', header: 'Half day', sortable: false, value: (r) => (r.isHalfDay ? 'Yes' : '—') },
  ];

  const typeOptions = HOLIDAY_TYPES.map((t) => ({ value: t, label: P11_TYPE_LABELS[t] }));
  const notPublished = !data.published;

  const header = (
    <Card>
      <CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }} justifyContent="space-between">
          <Typography variant="h4" component="h2">
            Public holidays — {data.stateLabel ?? 'State not set'}
          </Typography>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <TextField
              select
              label="Year"
              value={String(data.year)}
              onChange={(e) => set({ year: e.target.value, page: null })}
              sx={{ minWidth: 120 }}
              disabled={pending}
            >
              {data.years.map((y) => (
                <MenuItem key={y} value={String(y)}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              onChange={(_e, v) => v && set({ view: v === 'list' ? null : v, page: null })}
              aria-label="View"
            >
              <ToggleButton value="list">List</ToggleButton>
              <ToggleButton value="calendar">Calendar</ToggleButton>
            </ToggleButtonGroup>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Published public holidays and replacement holidays for your work state. Half-day holidays are marked.
        </Typography>
      </CardContent>
    </Card>
  );

  const calendar = notPublished ? (
    <Card>
      <EmptyState title={data.unpublishedNote ?? `The ${data.year} calendar has not been published yet.`} />
    </Card>
  ) : data.calendar.length === 0 ? (
    <Card>
      <EmptyState kind={list.activeFilterCount ? 'filtered' : 'none'} title={list.activeFilterCount ? 'No holidays match these filters.' : 'No holidays in this year.'} />
    </Card>
  ) : (
    <HolidayCalendarView
      year={data.year}
      holidays={data.calendar.map((h) => ({
        id: h.id,
        date: h.date,
        name: h.name,
        replacement: true, // read-only for employees (no edit target)
        halfDay: h.isHalfDay,
      }))}
    />
  );

  return (
    <Stack spacing={2}>
      {header}
      {notPublished && view === 'list' && <Alert severity="info">{data.unpublishedNote ?? `The ${data.year} calendar has not been published yet.`}</Alert>}
      <ListPage<MyHolidayRow>
        itemName={{ singular: 'holiday', plural: 'holidays' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => list.setDraftField('q', v)} hint="Searches the holiday name." />,
          <MultiSelectFilter key="types" label="Type" value={d.types} onChange={(v) => list.setDraftField('types', v)} options={typeOptions} />,
        ]}
        {...list.listProps}
        activeFilterCount={[list.applied.filters.q, list.applied.filters.types].filter(Boolean).length}
        onExport={
          notPublished
            ? undefined
            : async () => {
                try {
                  const res = await exportMyHolidaysCsv({ ...params, year: data.year });
                  if (res.ok) downloadServerCsv(res.filename || 'public-holidays', res.content);
                  else toast.info(res.error);
                } catch {
                  toast.info('Export failed. Please try again.');
                }
              }
        }
        columns={columns}
        rows={data.page.rows}
        total={data.page.total}
        getRowId={(r) => `${r.kind}:${r.id}`}
        getRowRef={(r) => `${formatDate(r.date)} ${r.name}`}
        empty={{ title: notPublished ? `The ${data.year} calendar has not been published yet.` : 'No holidays in this year.' }}
        bodyOverride={view === 'calendar' ? calendar : undefined}
      />
    </Stack>
  );
}
