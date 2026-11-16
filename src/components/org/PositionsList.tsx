'use client';

// O3 · Positions — S-OR-03 · /organisation/positions · F-ORG-03 · US-ORG-002.
// List: Search code/title · Filters Department, Grade, Active · Columns Code › · Title ·
// Default department · Default grade · Headcount · Active ●.
// Form: Code * · Title * (100; "Used as designation on the EA form") · Default department ·
// Default grade · Description (1000) · Active *.
import * as React from 'react';
import type { OrgOptions, PositionDetail, PositionListParams, PositionRow } from '@/server/contracts/org';
import { createPosition, exportPositionsCsv, setPositionActive, updatePosition } from '@/server/actions/org';
import StatusChip from '../StatusChip';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import type { ListColumn } from '../list/ListPage';
import { FormGrid, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import MasterList, { csvResult } from './MasterList';
import { POSITION_FILTERS } from './filters';
import { ACTIVE_FILTER_OPTIONS, activeLabel, countOrDash, orgFilterOptions, orgOptions, stampsMeta } from './common';

type FormValue = { code: string; title: string; defaultDepartmentId: string; defaultGradeId: string; description: string; isActive: boolean };

export default function PositionsList({
  rows,
  total,
  params,
  detail,
  options,
}: {
  rows: PositionRow[];
  total: number;
  params: PositionListParams;
  detail: PositionDetail | null;
  options: Pick<OrgOptions, 'departments' | 'grades'>;
}) {
  const columns: ListColumn<PositionRow>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'title', header: 'Title', value: (r) => r.title, minWidth: 200 },
    { key: 'department', header: 'Default department', value: (r) => r.defaultDepartmentName ?? '' },
    { key: 'grade', header: 'Default grade', value: (r) => r.defaultGradeName ?? '', priority: 'low' },
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
    <MasterList<PositionRow, PositionDetail, FormValue, typeof POSITION_FILTERS>
      itemName={{ singular: 'position', plural: 'positions' }}
      csvName="positions"
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      detail={detail}
      getDetailId={(d) => d.id}
      rowLabel={(r) => `${r.code} · ${r.title}`}
      defaults={{ filters: POSITION_FILTERS, sort: { key: 'code', direction: 'asc' } }}
      renderFilters={(d, set) => [
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches code and title" />,
        <SelectFilter key="dept" label="Department" value={d.departmentId} onChange={(v) => set('departmentId', v)} options={orgFilterOptions(options.departments)} />,
        <SelectFilter key="grade" label="Grade" value={d.gradeId} onChange={(v) => set('gradeId', v)} options={orgFilterOptions(options.grades)} />,
        <SelectFilter key="active" label="Active" value={d.active} onChange={(v) => set('active', v)} options={ACTIVE_FILTER_OPTIONS} />,
      ]}
      columns={columns}
      canEdit
      addLabel="Add new position"
      formTitle={(d) => (d ? `Edit position ${d.code}` : 'New position')}
      emptyForm={() => ({ code: '', title: '', defaultDepartmentId: '', defaultGradeId: '', description: '', isActive: true })}
      toForm={(d) => ({
        code: d.code,
        title: d.title,
        defaultDepartmentId: d.defaultDepartmentId ?? '',
        defaultGradeId: d.defaultGradeId ?? '',
        description: d.description ?? '',
        isActive: d.isActive,
      })}
      fieldLabels={{ code: 'Code', title: 'Title', defaultDepartmentId: 'Default department', defaultGradeId: 'Default grade', description: 'Description' }}
      validate={(v) => {
        const e: Record<string, string> = {};
        if (!v.code.trim()) e.code = 'Code is required.';
        if (!v.title.trim()) e.title = 'Title is required.';
        return e;
      }}
      onSave={(v, d) => {
        const input = {
          code: v.code,
          title: v.title,
          defaultDepartmentId: v.defaultDepartmentId || null,
          defaultGradeId: v.defaultGradeId || null,
          description: v.description,
          isActive: v.isActive,
        };
        return d ? updatePosition({ ...input, id: d.id }) : createPosition(input);
      }}
      savedMessage={(v) => `Position ${v.code.trim().toUpperCase()} saved.`}
      isActive={(r) => r.isActive}
      onSetActive={(r, isActive) => setPositionActive({ id: r.id, isActive })}
      meta={stampsMeta}
      onExport={async () => csvResult(await exportPositionsCsv(params))}
      renderForm={({ value, set, errors }) => (
        <FormGrid>
          <TextInput label="Code" required value={value.code} onChange={(v) => set('code', v.toUpperCase())} maxLength={10} error={errors.code} helper="Unique; letters, digits, - or _ (max 10)" />
          <TextInput label="Title" required value={value.title} onChange={(v) => set('title', v)} maxLength={100} error={errors.title} helper="Used as designation on the EA form" />
          <SelectInput
            label="Default department"
            value={value.defaultDepartmentId}
            onChange={(v) => set('defaultDepartmentId', v)}
            options={orgOptions(options.departments, [value.defaultDepartmentId])}
            emptyLabel="— None —"
            error={errors.defaultDepartmentId}
          />
          <SelectInput
            label="Default grade"
            value={value.defaultGradeId}
            onChange={(v) => set('defaultGradeId', v)}
            options={orgOptions(options.grades, [value.defaultGradeId])}
            emptyLabel="— None —"
            error={errors.defaultGradeId}
          />
          <TextInput full label="Description" value={value.description} onChange={(v) => set('description', v)} maxLength={1000} multiline minRows={3} error={errors.description} />
          <SwitchInput label="Active *" checked={value.isActive} onChange={(v) => set('isActive', v)} error={errors.isActive} />
        </FormGrid>
      )}
    />
  );
}
