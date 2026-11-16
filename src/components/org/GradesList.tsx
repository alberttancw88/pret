'use client';

// O4 · Grades — S-OR-04 · /organisation/grades · F-ORG-04 · US-ORG-002.
// List: Search · Filter Active · Columns Code › · Name · Rank · Headcount · Active ●.
// Form: Code * · Name * · Rank * (number, unique) · Active *.
// Note "Kakitangan Position Level imports here (Q25)."
import * as React from 'react';
import Alert from '@mui/material/Alert';
import type { GradeDetail, GradeListParams, GradeRow } from '@/server/contracts/org';
import { createGrade, exportGradesCsv, setGradeActive, updateGrade } from '@/server/actions/org';
import StatusChip from '../StatusChip';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import type { ListColumn } from '../list/ListPage';
import { FormGrid, NumberInput, SwitchInput, TextInput } from '../forms/fields';
import MasterList, { csvResult } from './MasterList';
import { GRADE_FILTERS } from './filters';
import { ACTIVE_FILTER_OPTIONS, activeLabel, countOrDash, stampsMeta } from './common';

type FormValue = { code: string; name: string; rank: string; isActive: boolean };

export default function GradesList({ rows, total, params, detail }: { rows: GradeRow[]; total: number; params: GradeListParams; detail: GradeDetail | null }) {
  const columns: ListColumn<GradeRow>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'name', header: 'Name', value: (r) => r.name, minWidth: 180 },
    { key: 'rank', header: 'Rank', align: 'right', value: (r) => r.rank },
    { key: 'headcount', header: 'Headcount', align: 'right', sortable: false, value: (r) => countOrDash(r.headcount) },
    {
      key: 'active',
      header: 'Active',
      kind: 'status',
      sortable: false,
      value: (r) => activeLabel(r.isActive),
      render: (r) => <StatusChip set="active" value={activeLabel(r.isActive)} />,
    },
  ];
  return (
    <MasterList<GradeRow, GradeDetail, FormValue, typeof GRADE_FILTERS>
      itemName={{ singular: 'grade', plural: 'grades' }}
      csvName="grades"
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      detail={detail}
      getDetailId={(d) => d.id}
      rowLabel={(r) => `${r.code} · ${r.name}`}
      defaults={{ filters: GRADE_FILTERS, sort: { key: 'rank', direction: 'asc' } }}
      renderFilters={(d, set) => [
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches code and name" />,
        <SelectFilter key="active" label="Active" value={d.active} onChange={(v) => set('active', v)} options={ACTIVE_FILTER_OPTIONS} />,
      ]}
      columns={columns}
      canEdit
      addLabel="Add new grade"
      formTitle={(d) => (d ? `Edit grade ${d.code}` : 'New grade')}
      emptyForm={() => ({ code: '', name: '', rank: '', isActive: true })}
      toForm={(d) => ({ code: d.code, name: d.name, rank: String(d.rank), isActive: d.isActive })}
      fieldLabels={{ code: 'Code', name: 'Name', rank: 'Rank', isActive: 'Active' }}
      validate={(v) => {
        const e: Record<string, string> = {};
        if (!v.code.trim()) e.code = 'Code is required.';
        if (!v.name.trim()) e.name = 'Name is required.';
        if (!/^\d+$/.test(v.rank.trim())) e.rank = 'Rank must be a whole number.';
        return e;
      }}
      onSave={(v, d) => {
        const input = { code: v.code, name: v.name, rank: v.rank, isActive: v.isActive };
        return d ? updateGrade({ ...input, id: d.id }) : createGrade(input);
      }}
      savedMessage={(v) => `Grade ${v.code.trim().toUpperCase()} saved.`}
      isActive={(r) => r.isActive}
      onSetActive={(r, isActive) => setGradeActive({ id: r.id, isActive })}
      deactivateBody={(r) =>
        r.headcount ? `${r.headcount} active employee(s) hold this grade. Move them first.` : `${r.name} will no longer be offered for new records.`
      }
      meta={stampsMeta}
      onExport={async () => csvResult(await exportGradesCsv(params))}
      formNotice={() => (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          Kakitangan Position Level imports here (Q25).
        </Alert>
      )}
      renderForm={({ value, set, errors }) => (
        <FormGrid>
          <TextInput label="Code" required value={value.code} onChange={(v) => set('code', v.toUpperCase())} maxLength={10} error={errors.code} helper="Unique; letters, digits, - or _ (max 10)" />
          <TextInput label="Name" required value={value.name} onChange={(v) => set('name', v)} maxLength={80} error={errors.name} />
          <NumberInput label="Rank" required value={value.rank} onChange={(v) => set('rank', v)} min={1} max={999} step={1} error={errors.rank} helper="Unique whole number (1–999)" />
          <SwitchInput label="Active *" checked={value.isActive} onChange={(v) => set('isActive', v)} error={errors.isActive} />
        </FormGrid>
      )}
    />
  );
}
