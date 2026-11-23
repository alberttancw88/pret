'use client';

// Form field wrappers (components.md §2): outlined, floating label, mandatory " *",
// error under the field, character counter where a max length applies, dd/mm/yyyy dates.
// Locked fields render read-only with a lock adornment and a tooltip naming why.
import * as React from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import FormLabel from '@mui/material/FormLabel';
import Grid from '@mui/material/Grid';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs from 'dayjs';
import { useRestorableField } from './unsaved';

export type Option = { value: string; label: string; secondary?: string; disabled?: boolean };

/** 12-col grid with two-up fields from `sm` (components.md §2 form layout). */
export function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <Grid container spacing={2}>
      {React.Children.toArray(children)
        .filter(Boolean)
        .map((child, i) => {
          const full = React.isValidElement(child) && (child.type === FullRow || (child.props as { full?: boolean }).full);
          return (
            <Grid key={i} size={{ xs: 12, sm: full ? 12 : 6 }}>
              {child}
            </Grid>
          );
        })}
    </Grid>
  );
}

/** Spans both columns inside FormGrid (alerts, notes, editors). */
export function FullRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function lockAdornment(reason: string) {
  return (
    <InputAdornment position="end">
      <Tooltip title={reason}>
        <LockIcon fontSize="small" aria-label={reason} sx={{ color: 'text.secondary' }} />
      </Tooltip>
    </InputAdornment>
  );
}

const lockedSx = { '& .MuiInputBase-root': { bgcolor: '#F7F7F9' } } as const;

type BaseProps = {
  label: string;
  required?: boolean;
  error?: string;
  helper?: React.ReactNode;
  /** Read-only with lock + tooltip (e.g. "Only a Super Admin can change this."). */
  locked?: string | false;
  disabled?: boolean;
  /** Span both columns inside FormGrid. */
  full?: boolean;
  name?: string;
  /** Never kept for restore after a session timeout (identifiers, secrets) — G9. */
  sensitive?: boolean;
};

export function TextInput({
  label,
  value,
  onChange,
  required,
  error,
  helper,
  locked,
  disabled,
  maxLength,
  multiline,
  minRows,
  type = 'text',
  inputMode,
  autoComplete,
  name,
  counter,
  sensitive,
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
  multiline?: boolean;
  minRows?: number;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  autoComplete?: string;
  /** Show "n/max" under the field (text areas). */
  counter?: boolean;
  full?: boolean;
}) {
  const showCounter = counter ?? (multiline && !!maxLength);
  const helperNode = error ?? helper;
  const restoreRef = useRestorableField({
    label: name ?? label,
    value,
    onChange: (v) => onChange(String(v ?? '')),
    sensitive: sensitive || autoComplete === 'off' || autoComplete === 'one-time-code',
    type,
    disabled,
    locked: Boolean(locked),
  });
  return (
    <Box ref={restoreRef}>
      <TextField
        fullWidth
        name={name}
        label={label}
        required={required}
        value={value}
        type={type}
        onChange={(e) => onChange(maxLength ? e.target.value.slice(0, maxLength) : e.target.value)}
        error={Boolean(error)}
        helperText={helperNode ?? (showCounter ? ' ' : undefined)}
        disabled={disabled}
        multiline={multiline}
        minRows={minRows}
        autoComplete={autoComplete}
        sx={locked ? lockedSx : undefined}
        slotProps={{
          input: { readOnly: Boolean(locked), endAdornment: locked ? lockAdornment(locked) : undefined },
          htmlInput: { maxLength, inputMode },
        }}
      />
      {showCounter && maxLength && (
        <Typography
          variant="caption"
          component="p"
          aria-live="polite"
          sx={{ textAlign: 'right', mt: -2.5, color: value.length >= maxLength ? '#B42318' : 'text.secondary' }}
        >
          {value.length}/{maxLength}
        </Typography>
      )}
    </Box>
  );
}

export function SelectInput({
  label,
  value,
  onChange,
  options,
  required,
  error,
  helper,
  locked,
  disabled,
  name,
  emptyLabel,
  sensitive,
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  /** Adds a blank first option ("— None —"). */
  emptyLabel?: string;
}) {
  const lockedLabel = options.find((o) => o.value === value)?.label ?? '';
  const restoreRef = useRestorableField({
    label: name ?? label,
    value,
    // Only values that are still offered are restored.
    onChange: (v) => {
      const x = String(v ?? '');
      if (x === '' || options.some((o) => o.value === x && !o.disabled)) onChange(x);
    },
    sensitive,
    disabled,
    locked: Boolean(locked),
  });
  if (locked) {
    return <TextInput label={label} value={lockedLabel} onChange={() => undefined} locked={locked} helper={helper} required={required} />;
  }
  return (
    <TextField
      select
      ref={restoreRef}
      fullWidth
      name={name}
      label={label}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={Boolean(error)}
      helperText={error ?? helper}
      disabled={disabled}
    >
      {emptyLabel !== undefined && (
        <MenuItem value="">
          <em>{emptyLabel}</em>
        </MenuItem>
      )}
      {options.map((o) => (
        <MenuItem key={o.value} value={o.value} disabled={o.disabled}>
          {o.label}
          {o.secondary && (
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {o.secondary}
            </Typography>
          )}
        </MenuItem>
      ))}
    </TextField>
  );
}

/** Date input dd/mm/yyyy; value is 'YYYY-MM-DD' or ''. */
export function DateInput({
  label,
  value,
  onChange,
  required,
  error,
  helper,
  locked,
  disabled,
  minDate,
  maxDate,
  sensitive,
}: BaseProps & { value: string; onChange: (v: string) => void; minDate?: string; maxDate?: string }) {
  const restoreRef = useRestorableField({
    label,
    value,
    onChange: (v) => onChange(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : ''),
    sensitive,
    disabled,
    locked: Boolean(locked),
  });
  return (
    <DatePicker
      ref={restoreRef}
      label={required ? `${label} *` : label}
      value={value ? dayjs(value) : null}
      format="DD/MM/YYYY"
      readOnly={Boolean(locked)}
      disabled={disabled}
      minDate={minDate ? dayjs(minDate) : undefined}
      maxDate={maxDate ? dayjs(maxDate) : undefined}
      onChange={(v) => onChange(v && v.isValid() ? v.format('YYYY-MM-DD') : '')}
      slotProps={{
        textField: {
          fullWidth: true,
          error: Boolean(error),
          helperText: error ?? helper ?? (locked || undefined),
          sx: locked ? lockedSx : undefined,
        },
        openPickerButton: { 'aria-label': `Choose ${label.toLowerCase()}` },
      }}
    />
  );
}

export function NumberInput({
  label,
  value,
  onChange,
  required,
  error,
  helper,
  locked,
  disabled,
  min,
  max,
  step,
  suffix,
  sensitive,
}: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const restoreRef = useRestorableField({ label, value, onChange: (v) => onChange(String(v ?? '')), sensitive, disabled, locked: Boolean(locked) });
  return (
    <TextField
      ref={restoreRef}
      fullWidth
      type="number"
      label={label}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={Boolean(error)}
      helperText={error ?? helper}
      disabled={disabled}
      sx={locked ? lockedSx : undefined}
      slotProps={{
        input: {
          readOnly: Boolean(locked),
          endAdornment: locked ? lockAdornment(locked) : suffix ? <InputAdornment position="end">{suffix}</InputAdornment> : undefined,
        },
        htmlInput: { min, max, step, inputMode: step && step < 1 ? 'decimal' : 'numeric', className: 'pret-tnum' },
      }}
    />
  );
}

/** Boolean as a labelled switch (Active *, Observed by Interact *, …). */
export function SwitchInput({
  label,
  checked,
  onChange,
  helper,
  locked,
  disabled,
  error,
  sensitive,
}: BaseProps & { checked: boolean; onChange: (v: boolean) => void }) {
  const restoreRef = useRestorableField({ label, value: checked, onChange: (v) => onChange(Boolean(v)), sensitive, disabled, locked: Boolean(locked) });
  return (
    <FormControl ref={restoreRef} error={Boolean(error)} disabled={disabled}>
      <FormControlLabel
        control={
          <Switch checked={checked} onChange={(e) => !locked && onChange(e.target.checked)} disabled={disabled || Boolean(locked)} />
        }
        label={
          <span>
            {label} {locked && <LockIcon fontSize="inherit" aria-label={locked} sx={{ verticalAlign: 'middle', color: 'text.secondary' }} />}
          </span>
        }
      />
      {(error || helper) && <FormHelperText>{error ?? helper}</FormHelperText>}
    </FormControl>
  );
}

export function CheckboxInput({
  label,
  checked,
  onChange,
  helper,
  disabled,
  error,
  sensitive,
}: BaseProps & { checked: boolean; onChange: (v: boolean) => void }) {
  const restoreRef = useRestorableField({ label, value: checked, onChange: (v) => onChange(Boolean(v)), sensitive, disabled });
  return (
    <FormControl ref={restoreRef} error={Boolean(error)} disabled={disabled}>
      <FormControlLabel control={<Checkbox checked={checked} onChange={(e) => onChange(e.target.checked)} />} label={label} />
      {(error || helper) && <FormHelperText>{error ?? helper}</FormHelperText>}
    </FormControl>
  );
}

export function RadioInput({
  label,
  value,
  onChange,
  options,
  required,
  error,
  helper,
  row,
  disabled,
  sensitive,
}: BaseProps & { value: string; onChange: (v: string) => void; options: Option[]; row?: boolean }) {
  const id = React.useId();
  const restoreRef = useRestorableField({
    label,
    value,
    onChange: (v) => {
      const x = String(v ?? '');
      if (options.some((o) => o.value === x && !o.disabled)) onChange(x);
    },
    sensitive,
    disabled,
  });
  return (
    <FormControl ref={restoreRef} error={Boolean(error)} disabled={disabled}>
      <FormLabel id={id} required={required}>
        {label}
      </FormLabel>
      <RadioGroup aria-labelledby={id} row={row} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <FormControlLabel key={o.value} value={o.value} control={<Radio />} label={o.label} disabled={o.disabled} />
        ))}
      </RadioGroup>
      {(error || helper) && <FormHelperText>{error ?? helper}</FormHelperText>}
    </FormControl>
  );
}

/** Multi-select with chip tags (states, data categories, actions). */
export function MultiSelectInput({
  label,
  value,
  onChange,
  options,
  required,
  error,
  helper,
  locked,
  disabled,
  limitTags = 3,
  sensitive,
}: BaseProps & { value: string[]; onChange: (v: string[]) => void; options: Option[]; limitTags?: number }) {
  const selected = options.filter((o) => value.includes(o.value));
  const restoreRef = useRestorableField({
    label,
    value,
    onChange: (v) => onChange(Array.isArray(v) ? v.map(String).filter((x) => options.some((o) => o.value === x)) : []),
    sensitive,
    disabled,
    locked: Boolean(locked),
  });
  return (
    <Autocomplete
      ref={restoreRef}
      multiple
      disableCloseOnSelect
      options={options}
      value={selected}
      limitTags={limitTags}
      readOnly={Boolean(locked)}
      disabled={disabled}
      getOptionLabel={(o) => o.label}
      isOptionEqualToValue={(a, b) => a.value === b.value}
      onChange={(_e, v) => onChange(v.map((o) => o.value))}
      renderValue={(vals, getItemProps) =>
        vals.map((o, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} size="small" label={o.label} {...itemProps} />;
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          required={required && value.length === 0}
          error={Boolean(error)}
          helperText={error ?? helper ?? (locked || undefined)}
        />
      )}
    />
  );
}

/** Free-text chips (allowed email domains). */
export function ChipsInput({
  label,
  value,
  onChange,
  helper,
  error,
  locked,
}: BaseProps & { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={[] as string[]}
      value={value}
      readOnly={Boolean(locked)}
      onChange={(_e, v) => onChange((v as string[]).map((s) => s.trim().toLowerCase()).filter(Boolean))}
      renderValue={(vals, getItemProps) =>
        vals.map((o, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} size="small" label={o} {...itemProps} />;
        })
      }
      renderInput={(params) => (
        <TextField {...params} label={label} error={Boolean(error)} helperText={error ?? helper ?? 'Type a value and press Enter.'} />
      )}
    />
  );
}

/** Read-only key/value (components.md §13): caption label above body1 value. */
export function KeyValue({ label, value, full }: { label: string; value: React.ReactNode; full?: boolean }) {
  return (
    <Box data-full={full ? 'true' : undefined}>
      <Typography variant="caption" color="text.secondary" component="p">
        {label}
      </Typography>
      <Typography variant="body1" component="div" sx={{ wordBreak: 'break-word' }}>
        {value === null || value === undefined || value === '' ? '—' : value}
      </Typography>
    </Box>
  );
}
