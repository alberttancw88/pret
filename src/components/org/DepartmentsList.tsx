'use client';

// O2 · Departments — S-OR-02 · /organisation/departments · F-ORG-02 · US-ORG-002.
// List: Search code/name · Filters Active, Parent · Columns Code › · Name · Parent · Head ·
// Active headcount · Active ● · ⋮ Edit / Deactivate. Form: Code * (unique, 10) · Name * (80) ·
// Parent department (no cycles) · Head of department (active employee — after W2-003) ·
// Cost centre · Active *. Deactivate blocked with active employees: "Move {n} employees first."
import * as React from 'react';
import type { DepartmentDetail, DepartmentListParams, DepartmentRow, OrgOptions } from '@/server/contracts/org';
import { createDepartment, exportDepartmentsCsv, setDepartmentActive, updateDepartment } from '@/server/actions/org';
import StatusChip from '../StatusChip';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import type { ListColumn } from '../list/ListPage';
import { FormGrid, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import MasterList, { csvResult } from './MasterList';
import { DEPARTMENT_FILTERS } from './filters';
import { ACTIVE_FILTER_OPTIONS, activeLabel, countOrDash, orgFilterOptions, orgOptions, stampsMeta } from './common';

type FormValue = { code: string; name: string; parentId: string; costCentreId: string; isActive: boolean };

export default function DepartmentsList({
  rows,
  total,
  params,
  detail,
  options,
}: {
  rows: DepartmentRow[];
  total: number;
  params: DepartmentListParams;
  detail: DepartmentDetail | null;
  options: Pick<OrgOptions, 'departments' | 'costCentres'>;
}) {
  const columns: ListColumn<DepartmentRow>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'name', header: 'Name', value: (r) => r.name, minWidth: 180 },
    { key: 'parent', header: 'Parent', value: (r) => r.parentName ?? '' },
    { key: 'head', header: 'Head', value: (r) => r.headName ?? '', priority: 'low', sortable: false },
    { key: 'headcount', header: 'Active headcount', align: 'right', value: (r) => countOrDash(r.activeHeadcount), sortable: false },
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
    <MasterList<DepartmentRow, DepartmentDetail, FormValue, typeof DEPARTMENT_FILTERS>
      itemName={{ singular: 'department', plural: 'departments' }}
      csvName="departments"
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      detail={detail}
      getDetailId={(d) => d.id}
      rowLabel={(r) => `${r.code} · ${r.name}`}
      defaults={{ filters: DEPARTMENT_FILTERS, sort: { key: 'code', direction: 'asc' } }}
      renderFilters={(d, set) => [
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches code and name" />,
        <SelectFilter key="active" label="Active" value={d.active} onChange={(v) => set('active', v)} options={ACTIVE_FILTER_OPTIONS} />,
        <SelectFilter key="parent" label="Parent" value={d.parentId} onChange={(v) => set('parentId', v)} options={orgFilterOptions(options.departments)} />,
      ]}
      columns={columns}
      canEdit
      addLabel="Add new department"
      formTitle={(d) => (d ? `Edit department ${d.code}` : 'New department')}
      emptyForm={() => ({ code: '', name: '', parentId: '', costCentreId: '', isActive: true })}
      toForm={(d) => ({ code: d.code, name: d.name, parentId: d.parentId ?? '', costCentreId: d.costCentreId ?? '', isActive: d.isActive })}
      fieldLabels={{ code: 'Code', name: 'Name', parentId: 'Parent department', costCentreId: 'Cost centre', headEmployeeId: 'Head of department', isActive: 'Active' }}
      validate={(v) => {
        const e: Record<string, string> = {};
        if (!v.code.trim()) e.code = 'Code is required.';
        if (!v.name.trim()) e.name = 'Name is required.';
        return e;
      }}
      onSave={(v, d) => {
        const input = { code: v.code, name: v.name, parentId: v.parentId || null, headEmployeeId: d?.headEmployeeId ?? null, costCentreId: v.costCentreId || null, isActive: v.isActive };
        return d ? updateDepartment({ ...input, id: d.id }) : createDepartment(input);
      }}
      savedMessage={(v) => `Department ${v.code.trim().toUpperCase()} saved.`}
      isActive={(r) => r.isActive}
      onSetActive={(r, isActive) => setDepartmentActive({ id: r.id, isActive })}
      deactivateBody={(r) =>
        r.activeHeadcount
          ? `Move ${r.activeHeadcount} employee${r.activeHeadcount === 1 ? '' : 's'} first.`
          : `${r.name} will no longer be offered for new records. Existing records keep it.`
      }
      meta={stampsMeta}
      onExport={async () => csvResult(await exportDepartmentsCsv(params))}
      renderForm={({ value, set, errors }, d) => (
        <FormGrid>
          <TextInput label="Code" required value={value.code} onChange={(v) => set('code', v.toUpperCase())} maxLength={10} error={errors.code} helper="Unique; letters, digits, - or _ (max 10)" />
          <TextInput label="Name" required value={value.name} onChange={(v) => set('name', v)} maxLength={80} error={errors.name} />
          <SelectInput
            label="Parent department"
            value={value.parentId}
            onChange={(v) => set('parentId', v)}
            options={orgOptions(options.departments, [value.parentId]).filter((o) => o.value !== d?.id)}
            emptyLabel="— None (top level) —"
            error={errors.parentId}
            helper="A department can't sit under itself or one of its own sub-departments."
          />
          <SelectInput
            label="Head of department"
            value=""
            onChange={() => undefined}
            options={[]}
            disabled
            error={errors.headEmployeeId}
            helper="Available after employee records are added."
          />
          <SelectInput
            label="Cost centre"
            value={value.costCentreId}
            onChange={(v) => set('costCentreId', v)}
            options={orgOptions(options.costCentres, [value.costCentreId])}
            emptyLabel="— None —"
            error={errors.costCentreId}
          />
          <SwitchInput label="Active *" checked={value.isActive} onChange={(v) => set('isActive', v)} error={errors.isActive} />
        </FormGrid>
      )}
    />
  );
}
