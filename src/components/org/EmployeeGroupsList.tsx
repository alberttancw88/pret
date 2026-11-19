'use client';

// O10 · Employee groups — S-OR-10 · /organisation/groups · F-ORG-14 (Could) · US-ORG-011.
// List: Search · Filter Active · Columns Name › · Description · Members (count) ·
// Used by (limits / overrides) · Active ●. Form: Name * · Description · Members (multi employee
// picker with chips + ADD BY FILTER department / location, W2-003) · Active *.
import * as React from 'react';
import type { EmployeeGroupDetail, EmployeeGroupRow, GroupListParams, OrgOptions } from '@/server/contracts/org';
import { createEmployeeGroup, exportEmployeeGroupsCsv, setEmployeeGroupActive, updateEmployeeGroup } from '@/server/actions/org';
import StatusChip from '../StatusChip';
import { KeywordField, SelectFilter } from '../list/FilterFields';
import type { ListColumn } from '../list/ListPage';
import { FormGrid, FullRow, SwitchInput, TextInput } from '../forms/fields';
import MasterList, { csvResult } from './MasterList';
import { GROUP_FILTERS } from './filters';
import type { PickedEmployee } from '../employees/EmployeePicker';
import GroupMembersField from './GroupMembersField';
import { ACTIVE_FILTER_OPTIONS, activeLabel, countOrDash, stampsMeta } from './common';

type FormValue = { name: string; description: string; members: PickedEmployee[]; isActive: boolean };

export default function EmployeeGroupsList({
  rows,
  total,
  params,
  detail,
  options,
}: {
  rows: EmployeeGroupRow[];
  total: number;
  params: GroupListParams;
  detail: EmployeeGroupDetail | null;
  options: OrgOptions;
}) {
  const columns: ListColumn<EmployeeGroupRow>[] = [
    { key: 'name', header: 'Name', value: (r) => r.name, minWidth: 180 },
    { key: 'description', header: 'Description', sortable: false, value: (r) => r.description ?? '', priority: 'low', minWidth: 220 },
    { key: 'members', header: 'Members', align: 'right', sortable: false, value: (r) => countOrDash(r.memberCount) },
    { key: 'usedBy', header: 'Used by (limits / overrides)', align: 'right', sortable: false, value: (r) => countOrDash(r.usedBy) },
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
    <MasterList<EmployeeGroupRow, EmployeeGroupDetail, FormValue, typeof GROUP_FILTERS>
      itemName={{ singular: 'employee group', plural: 'employee groups' }}
      csvName="employee-groups"
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      detail={detail}
      getDetailId={(d) => d.id}
      rowLabel={(r) => r.name}
      defaults={{ filters: GROUP_FILTERS, sort: { key: 'name', direction: 'asc' } }}
      renderFilters={(d, set) => [
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches name and description" />,
        <SelectFilter key="active" label="Active" value={d.active} onChange={(v) => set('active', v)} options={ACTIVE_FILTER_OPTIONS} />,
      ]}
      columns={columns}
      canEdit
      addLabel="Add new employee group"
      formTitle={(d) => (d ? `Edit employee group ${d.name}` : 'New employee group')}
      emptyForm={() => ({ name: '', description: '', members: [], isActive: true })}
      toForm={(d) => ({ name: d.name, description: d.description ?? '', members: d.members.map((m) => ({ id: m.employeeId, employeeNo: m.employeeNo, name: m.name })), isActive: d.isActive })}
      fieldLabels={{ name: 'Name', description: 'Description' }}
      validate={(v): Record<string, string> => (v.name.trim() ? {} : { name: 'Name is required.' })}
      onSave={(v, d) => {
        const input = { name: v.name, description: v.description, isActive: v.isActive, memberIds: v.members.map((m) => m.id) };
        return d ? updateEmployeeGroup({ ...input, id: d.id }) : createEmployeeGroup(input);
      }}
      savedMessage={(v) => `Employee group ${v.name.trim()} saved.`}
      isActive={(r) => r.isActive}
      onSetActive={(r, isActive) => setEmployeeGroupActive({ id: r.id, isActive })}
      meta={stampsMeta}
      onExport={async () => csvResult(await exportEmployeeGroupsCsv(params))}
      renderForm={({ value, set, errors }) => (
        <FormGrid>
          <TextInput full label="Name" required value={value.name} onChange={(v) => set('name', v)} maxLength={80} error={errors.name} helper="Unique" />
          <TextInput full label="Description" value={value.description} onChange={(v) => set('description', v)} maxLength={500} multiline minRows={2} error={errors.description} />
          <FullRow>
            <GroupMembersField value={value.members} onChange={(v) => set('members', v)} error={errors.memberIds} options={options} />
          </FullRow>
          <SwitchInput label="Active *" checked={value.isActive} onChange={(v) => set('isActive', v)} error={errors.isActive} />
        </FormGrid>
      )}
    />
  );
}
