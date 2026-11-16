'use client';

// O5 · Work locations — S-OR-05 · /organisation/locations · F-ORG-05 · US-ORG-003.
// List: Search name · Filters State, Active · Columns Name › · State · Default working pattern ·
// Active employees · Active ●. Form: WL1 Name * · WL2 Address * · WL3 State * (13 states + 3 FTs;
// "Determines the public-holiday calendar") · WL4 Default working-week pattern * · WL5 Active *.
// Changing WL3 warns "Leave of {n} employees will be recounted from {date}."
import * as React from 'react';
import Alert from '@mui/material/Alert';
import type { LocationDetail, LocationListParams, LocationRow, OrgOptions } from '@/server/contracts/org';
import { createLocation, exportLocationsCsv, setLocationActive, updateLocation } from '@/server/actions/org';
import StatusChip from '../StatusChip';
import { KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import type { ListColumn } from '../list/ListPage';
import { FormGrid, FullRow, SelectInput, SwitchInput, TextInput } from '../forms/fields';
import { useToast } from '../ToastProvider';
import MasterList, { csvResult } from './MasterList';
import AddressFields, { EMPTY_ADDRESS, type AddressValue } from './AddressFields';
import { LOCATION_FILTERS } from './filters';
import { STATE_OPTIONS, stateLabel } from './labels';
import { ACTIVE_FILTER_OPTIONS, activeLabel, countOrDash, orgOptions, stampsMeta } from './common';
import { formatDate, todayMyt } from '@/lib/format';

type FormValue = { name: string; address: AddressValue; defaultPatternId: string; isActive: boolean };

export default function LocationsList({
  rows,
  total,
  params,
  detail,
  options,
}: {
  rows: LocationRow[];
  total: number;
  params: LocationListParams;
  detail: LocationDetail | null;
  options: Pick<OrgOptions, 'workingPatterns'>;
}) {
  const toast = useToast();
  const columns: ListColumn<LocationRow>[] = [
    { key: 'name', header: 'Name', value: (r) => r.name, minWidth: 180 },
    { key: 'state', header: 'State', value: (r) => stateLabel(r.state) },
    { key: 'pattern', header: 'Default working pattern', value: (r) => r.defaultPatternName },
    { key: 'employees', header: 'Active employees', align: 'right', sortable: false, value: (r) => countOrDash(r.activeEmployees) },
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
    <MasterList<LocationRow, LocationDetail, FormValue, typeof LOCATION_FILTERS>
      itemName={{ singular: 'work location', plural: 'work locations' }}
      csvName="work-locations"
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      detail={detail}
      getDetailId={(d) => d.id}
      rowLabel={(r) => r.name}
      defaults={{ filters: LOCATION_FILTERS, sort: { key: 'name', direction: 'asc' } }}
      renderFilters={(d, set) => [
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches location name" />,
        <MultiSelectFilter key="state" label="State" value={d.state} onChange={(v) => set('state', v)} options={STATE_OPTIONS} />,
        <SelectFilter key="active" label="Active" value={d.active} onChange={(v) => set('active', v)} options={ACTIVE_FILTER_OPTIONS} />,
      ]}
      columns={columns}
      canEdit
      addLabel="Add new work location"
      formTitle={(d) => (d ? `Edit work location ${d.name}` : 'New work location')}
      emptyForm={() => ({ name: '', address: { ...EMPTY_ADDRESS }, defaultPatternId: '', isActive: true })}
      toForm={(d) => ({
        name: d.name,
        address: {
          line1: d.address.line1,
          line2: d.address.line2 ?? '',
          line3: d.address.line3 ?? '',
          postcode: d.address.postcode,
          city: d.address.city,
          state: d.state,
        },
        defaultPatternId: d.defaultPatternId,
        isActive: d.isActive,
      })}
      fieldLabels={{
        name: 'Location name',
        address: 'Address',
        state: 'State',
        defaultPatternId: 'Default working-week pattern',
        'address.line1': 'Address line 1',
        'address.postcode': 'Postcode',
        'address.city': 'City',
      }}
      validate={(v) => {
        const e: Record<string, string> = {};
        if (!v.name.trim()) e.name = 'Location name is required.';
        if (!v.address.line1.trim()) e.line1 = 'Address line 1 is required.';
        if (!/^\d{5}$/.test(v.address.postcode)) e.postcode = 'Postcode must be 5 digits.';
        if (!v.address.city.trim()) e.city = 'City is required.';
        if (!v.address.state) e.state = 'Select a state.';
        if (!v.defaultPatternId) e.defaultPatternId = 'Select a working-week pattern.';
        return e;
      }}
      onSave={(v, d) => {
        const input = {
          name: v.name,
          address: { line1: v.address.line1, line2: v.address.line2, line3: v.address.line3, postcode: v.address.postcode, city: v.address.city, country: 'Malaysia' },
          state: v.address.state as LocationDetail['state'],
          defaultPatternId: v.defaultPatternId,
          isActive: v.isActive,
        };
        return d ? updateLocation({ ...input, id: d.id }) : createLocation(input);
      }}
      savedMessage={(v) => `Work location ${v.name.trim()} saved.`}
      afterSave={(res) => {
        const r = res as unknown as { stateChanged?: boolean; affectedEmployees?: number };
        if (r.stateChanged && r.affectedEmployees)
          toast.info(`Leave of ${r.affectedEmployees} employee${r.affectedEmployees === 1 ? '' : 's'} will be recounted from ${formatDate(todayMyt())}.`);
      }}
      isActive={(r) => r.isActive}
      onSetActive={(r, isActive) => setLocationActive({ id: r.id, isActive })}
      deactivateBody={(r) =>
        r.activeEmployees ? `${r.activeEmployees} active employee(s) work here. Move them first.` : `${r.name} will no longer be offered for new records.`
      }
      meta={stampsMeta}
      onExport={async () => csvResult(await exportLocationsCsv(params))}
      formMaxWidth="md"
      formNotice={(v, d) =>
        d && v.address.state && v.address.state !== d.state ? (
          <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
            {`Changing the state changes the public-holiday calendar. Leave of ${d.activeEmployees ?? 0} employee${d.activeEmployees === 1 ? '' : 's'} will be recounted from ${formatDate(todayMyt())}.`}
          </Alert>
        ) : null
      }
      renderForm={({ value, set, errors }) => (
        <FormGrid>
          <TextInput full label="Location name" required value={value.name} onChange={(v) => set('name', v)} maxLength={80} error={errors.name} helper="Unique, e.g. HQ – Selangor" />
          <FullRow>
            <AddressFields
              legend="Address"
              value={value.address}
              onChange={(a) => set('address', a)}
              errors={{
                ...errors,
                line1: errors.line1 ?? errors['address.line1'],
                postcode: errors.postcode ?? errors['address.postcode'],
                city: errors.city ?? errors['address.city'],
              }}
              stateHelper="Determines the public-holiday calendar"
            />
          </FullRow>
          <SelectInput
            label="Default working-week pattern"
            required
            value={value.defaultPatternId}
            onChange={(v) => set('defaultPatternId', v)}
            options={orgOptions(options.workingPatterns, [value.defaultPatternId])}
            error={errors.defaultPatternId}
          />
          <SwitchInput label="Active *" checked={value.isActive} onChange={(v) => set('isActive', v)} error={errors.isActive} />
        </FormGrid>
      )}
    />
  );
}
