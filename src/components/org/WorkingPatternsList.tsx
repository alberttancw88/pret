'use client';

// O6 · Working-week patterns — S-OR-06 · /organisation/working-patterns · F-ORG-06 · US-ORG-004.
// List: Name › · Mon … Sun (F / ½ / Off / Rest) · Hours/day · Days-per-month basis · Effective from ·
// Used by (locations/employees) · Active ●.
// Form: WP1 Name * · WP2 Monday–Sunday grid (≥ 1 rest day, EA s59) · WP3 Hours per full day * (8) ·
// WP4 Working days per month basis * ("Used by payroll R1.1") · WP5 Effective from * (new version;
// "Future leave will be recounted; past leave is not", EC-ORG-03) · WP6 Active *.
// Editing: name/active save directly; a schedule change adds a NEW VERSION from a date.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import type { PatternListParams, PatternVersion, WorkingPatternDetail, WorkingPatternRow } from '@/server/contracts/org';
import { addPatternVersion, createWorkingPattern, exportWorkingPatternsCsv, setWorkingPatternActive, updateWorkingPattern } from '@/server/actions/org';
import StatusChip from '../StatusChip';
import DateText from '../DateText';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import type { ListColumn } from '../list/ListPage';
import { CheckboxInput, DateInput, FormGrid, FullRow, NumberInput, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import type { AnyActionResult } from '../forms/useActionRunner';
import MasterList, { csvResult } from './MasterList';
import WorkingWeekEditor, { STANDARD_WEEK, hasRestDay, REST_DAY_ERROR, type WeekPattern } from './WorkingWeekEditor';
import { PATTERN_FILTERS } from './filters';
import { DAY_TYPE_SHORT, MONTH_DAY_BASIS_LABELS, WEEKDAY_INFO, optionsOf, type MonthDayBasis } from './labels';
import { ACTIVE_FILTER_OPTIONS, activeLabel, stampsMeta } from './common';
import { addDays, formatDate, todayMyt } from '@/lib/format';

type FormValue = {
  name: string;
  isActive: boolean;
  /** Edit only: add a new version of the schedule. */
  changeSchedule: boolean;
  days: WeekPattern;
  hoursPerFullDay: string;
  monthDayBasis: MonthDayBasis;
  effectiveFrom: string;
};

const daysOf = (v: PatternVersion | null): WeekPattern => (v ? { ...v.days } : { ...STANDARD_WEEK });
const daysSummary = (d: WeekPattern) => WEEKDAY_INFO.map((w) => `${w.short} ${DAY_TYPE_SHORT[d[w.key]]}`).join(' · ');

export default function WorkingPatternsList({
  rows,
  total,
  params,
  detail,
}: {
  rows: WorkingPatternRow[];
  total: number;
  params: PatternListParams;
  detail: WorkingPatternDetail | null;
}) {
  const dayCols: ListColumn<WorkingPatternRow>[] = WEEKDAY_INFO.map((w) => ({
    key: w.key,
    header: w.short,
    align: 'center' as const,
    sortable: false,
    hideOnCard: true,
    value: (r: WorkingPatternRow) => (r.current ? DAY_TYPE_SHORT[r.current.days[w.key]] : ''),
  }));
  const columns: ListColumn<WorkingPatternRow>[] = [
    { key: 'name', header: 'Name', value: (r) => r.name, minWidth: 160 },
    ...dayCols,
    { key: 'hours', header: 'Hours/day', align: 'right', sortable: false, value: (r) => r.current?.hoursPerFullDay ?? '' },
    { key: 'basis', header: 'Days-per-month basis', sortable: false, priority: 'low', value: (r) => (r.current ? MONTH_DAY_BASIS_LABELS[r.current.monthDayBasis] : '') },
    {
      key: 'effectiveFrom',
      header: 'Effective from',
      kind: 'date',
      value: (r) => (r.current ? formatDate(r.current.effectiveFrom) : ''),
      render: (r) => <DateText value={r.current?.effectiveFrom ?? null} />,
    },
    {
      key: 'usedBy',
      header: 'Used by (locations/employees)',
      sortable: false,
      value: (r) => `${r.usedByLocations} / ${r.usedByEmployees ?? '—'}`,
    },
    {
      key: 'active',
      header: 'Active',
      kind: 'status',
      sortable: false,
      value: (r) => activeLabel(r.isActive),
      render: (r) => <StatusChip set="active" value={activeLabel(r.isActive)} />,
    },
  ];

  const latest = (d: WorkingPatternDetail) =>
    [...d.versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;

  const save = async (v: FormValue, d: WorkingPatternDetail | null): Promise<AnyActionResult> => {
    const version = {
      effectiveFrom: v.effectiveFrom,
      ...v.days,
      hoursPerFullDay: v.hoursPerFullDay,
      monthDayBasis: v.monthDayBasis,
    };
    // Nested `version.*` errors map onto the form fields.
    const unnest = (r: AnyActionResult): AnyActionResult => {
      if (r.ok) return r;
      const fe: Record<string, string> = {};
      for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) fe[k.replace(/^version\./, '')] = msg;
      return { ...r, fieldErrors: fe };
    };
    if (!d) return unnest(await createWorkingPattern({ name: v.name, isActive: v.isActive, version }));
    if (v.name !== d.name || v.isActive !== d.isActive) {
      const r = await updateWorkingPattern({ id: d.id, name: v.name, isActive: v.isActive });
      if (!r.ok) return r;
    }
    if (v.changeSchedule) {
      const r = unnest(await addPatternVersion({ patternId: d.id, version }));
      if (!r.ok) return r;
    }
    return { ok: true };
  };

  return (
    <MasterList<WorkingPatternRow, WorkingPatternDetail, FormValue, typeof PATTERN_FILTERS>
      itemName={{ singular: 'working-week pattern', plural: 'working-week patterns' }}
      csvName="working-patterns"
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      detail={detail}
      getDetailId={(d) => d.id}
      rowLabel={(r) => r.name}
      defaults={{ filters: PATTERN_FILTERS, sort: { key: 'name', direction: 'asc' } }}
      renderFilters={(d, set) => [
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches pattern name" />,
        <SelectFilter key="active" label="Active" value={d.active} onChange={(v) => set('active', v)} options={ACTIVE_FILTER_OPTIONS} />,
      ]}
      columns={columns}
      canEdit
      addLabel="Add new working pattern"
      formMaxWidth="md"
      formTitle={(d) => (d ? `Edit working pattern ${d.name}` : 'New working-week pattern')}
      emptyForm={() => ({
        name: '',
        isActive: true,
        changeSchedule: true,
        days: { ...STANDARD_WEEK },
        hoursPerFullDay: '8.0',
        monthDayBasis: 'fixed_26',
        effectiveFrom: todayMyt(),
      })}
      toForm={(d) => {
        const v = latest(d);
        return {
          name: d.name,
          isActive: d.isActive,
          changeSchedule: false,
          days: daysOf(v),
          hoursPerFullDay: v?.hoursPerFullDay ?? '8.0',
          monthDayBasis: v?.monthDayBasis ?? 'fixed_26',
          effectiveFrom: addDays(todayMyt(), 1),
        };
      }}
      fieldLabels={{
        name: 'Pattern name',
        hoursPerFullDay: 'Hours per full working day',
        monthDayBasis: 'Working days per month basis',
        effectiveFrom: 'Effective from',
        sun: 'Working week',
        mon: 'Working week',
      }}
      validate={(v) => {
        const e: Record<string, string> = {};
        if (!v.name.trim()) e.name = 'Pattern name is required.';
        if (v.changeSchedule) {
          if (!hasRestDay(v.days)) e.sun = REST_DAY_ERROR;
          const h = Number(v.hoursPerFullDay);
          if (!(h >= 0.5 && h <= 24) || Math.round(h * 10) !== h * 10) e.hoursPerFullDay = 'Enter 0.5–24 hours, at most one decimal place.';
          if (!v.effectiveFrom) e.effectiveFrom = 'Enter a date.';
        }
        return e;
      }}
      onSave={save}
      savedMessage={(v) => `Working pattern ${v.name.trim()} saved.`}
      isActive={(r) => r.isActive}
      onSetActive={(r, isActive) => setWorkingPatternActive({ id: r.id, isActive })}
      deactivateBody={(r) =>
        r.usedByLocations > 0
          ? `${r.usedByLocations} work location(s) use this pattern as their default. Change them first.`
          : `${r.name} will no longer be offered for new records.`
      }
      meta={stampsMeta}
      onExport={async () => csvResult(await exportWorkingPatternsCsv(params))}
      renderForm={({ value, set, errors, editing }, d) => (
        <FormGrid>
          <TextInput label="Pattern name" required value={value.name} onChange={(v) => set('name', v)} maxLength={60} error={errors.name} helper="Unique" />
          <SwitchInput label="Active *" checked={value.isActive} onChange={(v) => set('isActive', v)} error={errors.isActive} />

          {editing && d && (
            <FullRow>
              <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                Versions
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label="Pattern versions">
                  <TableHead>
                    <TableRow>
                      <TableCell>Effective from</TableCell>
                      <TableCell>Week</TableCell>
                      <TableCell align="right">Hours/day</TableCell>
                      <TableCell>Basis</TableCell>
                      <TableCell>Added</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[...d.versions]
                      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
                      .map((v) => (
                        <TableRow key={v.id}>
                          <TableCell>
                            <DateText value={v.effectiveFrom} />
                            {v.isFuture ? ' (future)' : ''}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{daysSummary(v.days)}</TableCell>
                          <TableCell align="right" className="pret-tnum">
                            {v.hoursPerFullDay}
                          </TableCell>
                          <TableCell>{MONTH_DAY_BASIS_LABELS[v.monthDayBasis]}</TableCell>
                          <TableCell>
                            <DateText value={v.createdAt} mode="datetime" /> {v.createdByName ? `by ${v.createdByName}` : ''}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </Box>
            </FullRow>
          )}

          {editing && (
            <FullRow>
              <CheckboxInput
                label="Change the working week from a date (adds a new version)"
                checked={value.changeSchedule}
                onChange={(v) => set('changeSchedule', v)}
                helper="Past and current versions can't be edited; a future version with the same date is replaced."
              />
            </FullRow>
          )}

          {value.changeSchedule && (
            <FullRow>
              <WorkingWeekEditor value={value.days} onChange={(days) => set('days', days)} error={errors.sun ?? errors.mon} />
            </FullRow>
          )}
          {value.changeSchedule && (
            <NumberInput
              label="Hours per full working day"
              required
              value={value.hoursPerFullDay}
              onChange={(v) => set('hoursPerFullDay', v)}
              min={0.5}
              max={24}
              step={0.5}
              error={errors.hoursPerFullDay}
              helper="Default 8; used for hourly rate / overtime (R1.1)"
            />
          )}
          {value.changeSchedule && (
            <SelectInput
              label="Working days per month basis"
              required
              value={value.monthDayBasis}
              onChange={(v) => set('monthDayBasis', v as MonthDayBasis)}
              options={optionsOf(MONTH_DAY_BASIS_LABELS)}
              error={errors.monthDayBasis}
              helper="Used by payroll R1.1"
            />
          )}
          {value.changeSchedule && (
            <DateInput
              label="Effective from"
              required
              value={value.effectiveFrom}
              onChange={(v) => set('effectiveFrom', v)}
              error={errors.effectiveFrom}
              helper="Future leave will be recounted; past leave is not."
            />
          )}
          {value.changeSchedule && editing && (
            <FullRow>
              <Alert severity="info" variant="outlined">
                The new week applies from {value.effectiveFrom ? formatDate(value.effectiveFrom) : 'the effective date'}. Leave already taken
                before that date is not recounted.
              </Alert>
            </FullRow>
          )}
        </FormGrid>
      )}
    />
  );
}
