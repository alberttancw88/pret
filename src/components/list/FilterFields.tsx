'use client';

// Filter-card fields (components.md §6.1): every populated field is clearable (×).
import * as React from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';

function ClearButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <InputAdornment position="end">
      <IconButton aria-label={`Clear ${label}`} onClick={onClear} edge="end" size="small">
        <CloseIcon fontSize="small" />
      </IconButton>
    </InputAdornment>
  );
}

/** Keyword search box — `hint` states which fields are searched. */
export function KeywordField({
  value,
  onChange,
  label = 'Search',
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
  hint?: string;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      helperText={hint}
      type="search"
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" aria-hidden />
            </InputAdornment>
          ),
          endAdornment: value ? <ClearButton label={label} onClear={() => onChange('')} /> : undefined,
        },
      }}
    />
  );
}

export type SelectOption = { value: string; label: string };

/** Single select with an × clear when populated. */
export function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      slotProps={{
        input: {
          endAdornment: value ? <ClearButton label={label} onClear={() => onChange('')} /> : undefined,
        },
        select: { IconComponent: value ? () => null : undefined },
      }}
    >
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** Date filter (dd/mm/yyyy) — value is 'YYYY-MM-DD' or ''. */
export function DateFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const d: Dayjs | null = value ? dayjs(value) : null;
  return (
    <DatePicker
      label={label}
      value={d}
      format="DD/MM/YYYY"
      onChange={(v) => onChange(v && v.isValid() ? v.format('YYYY-MM-DD') : '')}
      slotProps={{
        textField: { fullWidth: true, size: 'small', helperText: undefined },
        field: { clearable: true },
        openPickerButton: { 'aria-label': 'Choose date' },
      }}
    />
  );
}

/** Multi-select filter with chip tags (max 2 shown + "+n"); value is a comma list ('' = none). */
export function MultiSelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
}) {
  const values = value ? value.split(',') : [];
  const selected = options.filter((o) => values.includes(o.value));
  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      size="small"
      limitTags={2}
      options={options}
      value={selected}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      onChange={(_e, v) => onChange(v.map((o) => o.value).join(','))}
      renderValue={(vals, getItemProps) =>
        vals.map((o, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} size="small" label={o.label} {...itemProps} />;
        })
      }
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );
}

/** Yes / No select ('' = any). */
export function YesNoFilter({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <SelectFilter
      label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ]}
    />
  );
}
