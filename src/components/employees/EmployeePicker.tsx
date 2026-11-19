'use client';

// Employee picker (type-ahead) — reporting manager F13/JH6, approvers F15/F16, department
// head (O2), group members (O10), new manager (O8 / E15). Searches employee no. and name
// through the registered Server Action searchEmployeeOptions (ActionResult<{ rows }>). Shows "Name · INT-004 · Position".
import * as React from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import type { EmployeeOption } from '@/server/contracts/employees';
import { searchEmployeeOptions } from '@/server/actions/employees';

export type PickedEmployee = { id: string; employeeNo: string; name: string; position?: string | null };

const label = (o: PickedEmployee) => (o.employeeNo ? `${o.name} (${o.employeeNo})` : o.name);

/** Searches only once the picker has been opened (no server call per render of a list page). */
function useEmployeeSearch(excludeEmployeeId?: string | null, activeOnly = true) {
  const [input, setInput] = React.useState('');
  const [options, setOptions] = React.useState<EmployeeOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(async () => {
      let rows: EmployeeOption[] = [];
      try {
        const res = await searchEmployeeOptions({ q: input.trim() || undefined, excludeEmployeeId: excludeEmployeeId ?? undefined, activeOnly, limit: 50 });
        rows = res.ok ? res.rows : [];
      } catch {
        rows = [];
      }
      if (alive) {
        setOptions(rows);
        setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [input, excludeEmployeeId, activeOnly, enabled]);
  return { input, setInput, options, loading, enable: () => setEnabled(true) };
}

function renderOption(props: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key }, o: PickedEmployee) {
  const { key, ...rest } = props;
  return (
    <Box component="li" key={key} {...rest}>
      <Box>
        <Typography variant="body2">{label(o)}</Typography>
        {o.position && (
          <Typography variant="caption" color="text.secondary">
            {o.position}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default function EmployeePicker({
  label: fieldLabel,
  value,
  onChange,
  required,
  error,
  helper,
  disabled,
  excludeEmployeeId,
  activeOnly = true,
}: {
  label: string;
  value: PickedEmployee | null;
  onChange: (v: PickedEmployee | null) => void;
  required?: boolean;
  error?: string;
  helper?: React.ReactNode;
  disabled?: boolean;
  excludeEmployeeId?: string | null;
  activeOnly?: boolean;
}) {
  const s = useEmployeeSearch(excludeEmployeeId, activeOnly);
  const opts: PickedEmployee[] = s.options.map((o) => ({ id: o.id, employeeNo: o.employeeNo, name: o.name, position: o.position }));
  if (value && !opts.some((o) => o.id === value.id)) opts.unshift(value);
  return (
    <Autocomplete
      options={opts}
      value={value}
      disabled={disabled}
      loading={s.loading}
      filterOptions={(x) => x}
      getOptionLabel={label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_e, v) => onChange(v)}
      onOpen={s.enable}
      onInputChange={(_e, v, reason) => reason === 'input' && s.setInput(v)}
      renderOption={renderOption}
      noOptionsText="No matching employees"
      renderInput={(params) => <TextField {...params} label={fieldLabel} required={required} error={Boolean(error)} helperText={error ?? helper} />}
    />
  );
}

export function EmployeeMultiPicker({
  label: fieldLabel,
  value,
  onChange,
  error,
  helper,
  disabled,
}: {
  label: string;
  value: PickedEmployee[];
  onChange: (v: PickedEmployee[]) => void;
  error?: string;
  helper?: React.ReactNode;
  disabled?: boolean;
}) {
  const s = useEmployeeSearch(null, true);
  const opts: PickedEmployee[] = s.options.map((o) => ({ id: o.id, employeeNo: o.employeeNo, name: o.name, position: o.position }));
  for (const v of value) if (!opts.some((o) => o.id === v.id)) opts.push(v);
  return (
    <Autocomplete
      multiple
      disableCloseOnSelect
      options={opts}
      value={value}
      disabled={disabled}
      loading={s.loading}
      filterOptions={(x) => x}
      getOptionLabel={label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_e, v) => onChange(v)}
      onOpen={s.enable}
      onInputChange={(_e, v, reason) => reason === 'input' && s.setInput(v)}
      renderOption={renderOption}
      renderValue={(vals, getItemProps) =>
        vals.map((o, index) => {
          const { key, ...itemProps } = getItemProps({ index });
          return <Chip key={key} size="small" label={label(o)} {...itemProps} />;
        })
      }
      renderInput={(params) => <TextField {...params} label={fieldLabel} error={Boolean(error)} helperText={error ?? helper} />}
    />
  );
}
