'use client';

// O9 · Cost centres — S-OR-09 · /organisation/cost-centres · F-ORG-13 (Could) · US-ORG-011.
// List: Search · Filter Active · Columns Code › · Name · AutoCount project/department code · Active ●.
// Form: Code * · Name * · AutoCount code · Active *.
import * as React from 'react';
import type { CostCentreDetail, CostCentreListParams, CostCentreRow } from '@/server/contracts/org';
import { createCostCentre, exportCostCentresCsv, setCostCentreActive, updateCostCentre } from '@/server/actions/org';
import StatusChip from '../StatusChip';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import type { ListColumn } from '../list/ListPage';
import { FormGrid, SwitchInput, TextInput } from '../forms/fields';
import MasterList, { csvResult } from './MasterList';
import { COST_CENTRE_FILTERS } from './filters';
import { ACTIVE_FILTER_OPTIONS, activeLabel, stampsMeta } from './common';

type FormValue = { code: string; name: string; autocountCode: string; isActive: boolean };

export default function CostCentresList({
  rows,
  total,
  params,
  detail,
}: {
  rows: CostCentreRow[];
  total: number;
  params: CostCentreListParams;
  detail: CostCentreDetail | null;
}) {
  const columns: ListColumn<CostCentreRow>[] = [
    { key: 'code', header: 'Code', value: (r) => r.code },
    { key: 'name', header: 'Name', value: (r) => r.name, minWidth: 180 },
    { key: 'autocountCode', header: 'AutoCount project/department code', sortable: false, value: (r) => r.autocountCode ?? '' },
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
    <MasterList<CostCentreRow, CostCentreDetail, FormValue, typeof COST_CENTRE_FILTERS>
      itemName={{ singular: 'cost centre', plural: 'cost centres' }}
      csvName="cost-centres"
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      detail={detail}
      getDetailId={(d) => d.id}
      rowLabel={(r) => `${r.code} · ${r.name}`}
      defaults={{ filters: COST_CENTRE_FILTERS, sort: { key: 'code', direction: 'asc' } }}
      renderFilters={(d, set) => [
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches code and name" />,
        <SelectFilter key="active" label="Active" value={d.active} onChange={(v) => set('active', v)} options={ACTIVE_FILTER_OPTIONS} />,
      ]}
      columns={columns}
      canEdit
      addLabel="Add new cost centre"
      formTitle={(d) => (d ? `Edit cost centre ${d.code}` : 'New cost centre')}
      emptyForm={() => ({ code: '', name: '', autocountCode: '', isActive: true })}
      toForm={(d) => ({ code: d.code, name: d.name, autocountCode: d.autocountCode ?? '', isActive: d.isActive })}
      fieldLabels={{ code: 'Code', name: 'Name', autocountCode: 'AutoCount code', isActive: 'Active' }}
      validate={(v) => {
        const e: Record<string, string> = {};
        if (!v.code.trim()) e.code = 'Code is required.';
        if (!v.name.trim()) e.name = 'Name is required.';
        return e;
      }}
      onSave={(v, d) => {
        const input = { code: v.code, name: v.name, autocountCode: v.autocountCode, isActive: v.isActive };
        return d ? updateCostCentre({ ...input, id: d.id }) : createCostCentre(input);
      }}
      savedMessage={(v) => `Cost centre ${v.code.trim().toUpperCase()} saved.`}
      isActive={(r) => r.isActive}
      onSetActive={(r, isActive) => setCostCentreActive({ id: r.id, isActive })}
      meta={stampsMeta}
      onExport={async () => csvResult(await exportCostCentresCsv(params))}
      renderForm={({ value, set, errors }) => (
        <FormGrid>
          <TextInput label="Code" required value={value.code} onChange={(v) => set('code', v.toUpperCase())} maxLength={10} error={errors.code} helper="Unique; letters, digits, - or _ (max 10)" />
          <TextInput label="Name" required value={value.name} onChange={(v) => set('name', v)} maxLength={80} error={errors.name} />
          <TextInput
            label="AutoCount project/department code"
            value={value.autocountCode}
            onChange={(v) => set('autocountCode', v)}
            maxLength={30}
            error={errors.autocountCode}
            helper="Appears in the department/cost-centre column of AutoCount exports"
          />
          <SwitchInput label="Active *" checked={value.isActive} onChange={(v) => set('isActive', v)} error={errors.isActive} />
        </FormGrid>
      )}
    />
  );
}
