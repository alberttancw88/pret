'use client';

// Filter-card fields for the R3 report viewer — built from REPORT_FILTERS (reportFilters.ts).
// Every field is clearable (×) like the list filters; required fields carry "*" and an inline error.
import * as React from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormHelperText from '@mui/material/FormHelperText';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import ViewColumnOutlinedIcon from '@mui/icons-material/ViewColumnOutlined';
import {
  EMPLOYEE_FIELD_GROUPS,
  EMPLOYEE_FIELD_GROUP_LABELS,
  SENSITIVE_FIELD_CATEGORY_LABELS,
  type EmployeeFieldDef,
  type ReportFilterOptions,
} from '@/server/contracts/reports';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { optionsFor, type FilterDef, type Opt } from './reportFilters';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'yyyy-mm' options: 24 months back to 2 months ahead of today, newest first. */
export function monthOptions(today: string): Opt[] {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const out: Opt[] = [];
  for (let i = 2; i >= -24; i--) {
    const d = new Date(Date.UTC(y, m - 1 + i, 1));
    const v = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    out.push({ value: v, label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  return out;
}

export function yearOptions(today: string): Opt[] {
  const y = Number(today.slice(0, 4));
  const out: Opt[] = [];
  for (let n = y + 1; n >= y - 5; n--) out.push({ value: String(n), label: String(n) });
  return out;
}

/** Adds a value that is not in the generated list (e.g. a year from the URL) so the select can show it. */
function withValue(opts: Opt[], value: string): Opt[] {
  return value && !opts.some((x) => x.value === value) ? [{ value, label: value }, ...opts] : opts;
}

function Req({ label, required }: { label: string; required?: boolean }) {
  return <>{required ? `${label} *` : label}</>;
}

function ErrorLine({ error }: { error?: string }) {
  return error ? (
    <FormHelperText error sx={{ mx: 1.75 }}>
      {error}
    </FormHelperText>
  ) : null;
}

export function ReportFilterField({
  def,
  value,
  onChange,
  options,
  today,
  error,
}: {
  def: FilterDef;
  value: string;
  onChange: (v: string) => void;
  options: ReportFilterOptions;
  today: string;
  error?: string;
}) {
  switch (def.kind) {
    case 'keyword':
      return <KeywordField value={value} onChange={onChange} hint={def.hint} />;
    case 'select':
      return (
        <Box>
          {def.noClear ? (
            <TextField select label={<Req label={def.label} required={def.required} />} value={value} onChange={(e) => onChange(e.target.value)} error={Boolean(error)}>
              {def.options.map((x) => (
                <MenuItem key={x.value} value={x.value}>
                  {x.label}
                </MenuItem>
              ))}
            </TextField>
          ) : (
            <SelectFilter label={def.required ? `${def.label} *` : def.label} value={value} onChange={onChange} options={def.options} />
          )}
          <ErrorLine error={error} />
        </Box>
      );
    case 'multi':
      return <MultiSelectFilter label={def.label} value={value} onChange={onChange} options={def.options ?? (def.source ? optionsFor(def.source, options) : [])} />;
    case 'source':
      return (
        <Box>
          <SelectFilter label={def.required ? `${def.label} *` : def.label} value={value} onChange={onChange} options={optionsFor(def.source, options)} />
          <ErrorLine error={error} />
        </Box>
      );
    case 'date':
      return (
        <Box>
          <DateFilter label={def.required ? `${def.label} *` : def.label} value={value} onChange={onChange} />
          <ErrorLine error={error} />
        </Box>
      );
    case 'month':
      return (
        <Box>
          <SelectFilter label={def.required ? `${def.label} *` : def.label} value={value} onChange={onChange} options={withValue(monthOptions(today), value)} />
          <ErrorLine error={error} />
        </Box>
      );
    case 'year':
      return (
        <Box>
          <SelectFilter label={def.required ? `${def.label} *` : def.label} value={value} onChange={onChange} options={withValue(yearOptions(today), value)} />
          <ErrorLine error={error} />
        </Box>
      );
    case 'bool':
      return (
        <FormControlLabel
          sx={{ minHeight: 40, ml: 0 }}
          control={<Checkbox checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} />}
          label={def.label}
        />
      );
    case 'employee':
      return <EmployeeField label={def.label} required={def.required} value={value} onChange={onChange} options={options} error={error} />;
    case 'columns':
      return <ColumnChooser value={value} onChange={onChange} fields={options.employeeMasterFields} />;
  }
}

/** P7 / tax-treatment employee picker. EMP: fixed to self 🔒 (employeeLocked). MGR: self + team. ADM/SA: everyone. */
function EmployeeField({
  label,
  required,
  value,
  onChange,
  options,
  error,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  options: ReportFilterOptions;
  error?: string;
}) {
  const list = options.employees;
  const selected = list.find((e) => e.id === value) ?? null;
  if (options.employeeLocked) {
    return (
      <TextField
        label={label}
        value={selected?.label ?? list[0]?.label ?? 'Me'}
        disabled
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <LockIcon fontSize="small" aria-label="Fixed to you" />
              </InputAdornment>
            ),
          },
        }}
      />
    );
  }
  return (
    <Box>
      <Autocomplete
        size="small"
        options={list}
        value={selected}
        getOptionLabel={(o) => o.label}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        onChange={(_e, v) => onChange(v?.id ?? '')}
        renderInput={(params) => <TextField {...params} label={required ? `${label} *` : label} error={Boolean(error)} />}
      />
      <ErrorLine error={error} />
    </Box>
  );
}

/** "My team" 🔒 scope field shown to managers (R3: MGR scope forced to team). */
export function ScopeField({ scope }: { scope: 'team' | 'own' }) {
  return (
    <TextField
      label="Scope"
      value={scope === 'team' ? 'My team' : 'Me'}
      disabled
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <LockIcon fontSize="small" aria-label="Scope is fixed" />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// S-RP-04 column chooser: groups A–I of fields the user may view; sensitive groups ticked
// separately with 🔒 "logged".
// ---------------------------------------------------------------------------------------------
function ColumnChooser({ value, onChange, fields }: { value: string; onChange: (v: string) => void; fields: EmployeeFieldDef[] }) {
  const [open, setOpen] = React.useState(false);
  const chosen = value ? value.split(',').filter(Boolean) : [];
  const [draft, setDraft] = React.useState<string[]>(chosen);
  const sensitiveCount = fields.filter((f) => f.sensitive && chosen.includes(f.key)).length;
  const label = chosen.length ? `${chosen.length} columns` : 'Default columns';

  return (
    <>
      <Button
        variant="outlined"
        color="inherit"
        fullWidth
        startIcon={<ViewColumnOutlinedIcon />}
        onClick={() => {
          setDraft(chosen);
          setOpen(true);
        }}
        sx={{ justifyContent: 'flex-start', minHeight: 40 }}
      >
        Columns: {label}
        {sensitiveCount > 0 && <Chip size="small" icon={<LockIcon />} label={`${sensitiveCount} logged`} sx={{ ml: 1 }} />}
      </Button>
      <ResponsiveDialog
        open={open}
        onClose={() => setOpen(false)}
        title="Choose columns"
        maxWidth="md"
        actions={
          <>
            <Button color="inherit" onClick={() => setDraft([])}>
              Default columns
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button color="inherit" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={() => {
                onChange(draft.join(','));
                setOpen(false);
              }}
            >
              Apply
            </Button>
          </>
        }
      >
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Only fields you may view are listed. Columns marked <LockIcon sx={{ fontSize: 14, verticalAlign: '-2px' }} /> are sensitive: viewing and exporting
          them is written to the access log.
        </Typography>
        <Stack spacing={2}>
          {EMPLOYEE_FIELD_GROUPS.map((g) => {
            const inGroup = fields.filter((f) => f.group === g);
            if (inGroup.length === 0) return null;
            return (
              <Box key={g} component="fieldset" sx={{ border: 0, p: 0, m: 0 }}>
                <Typography component="legend" variant="subtitle2" sx={{ mb: 0.5 }}>
                  {g} · {EMPLOYEE_FIELD_GROUP_LABELS[g]}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, columnGap: 2 }}>
                  {inGroup.map((f) => (
                    <FormControlLabel
                      key={f.key}
                      control={
                        <Checkbox
                          size="small"
                          checked={draft.includes(f.key)}
                          onChange={() => setDraft((d) => (d.includes(f.key) ? d.filter((k) => k !== f.key) : [...d, f.key]))}
                        />
                      }
                      label={
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <span>
                            {f.label} <Typography component="span" variant="caption" color="text.secondary">({f.id})</Typography>
                          </span>
                          {f.sensitive && (
                            <Chip
                              size="small"
                              icon={<LockIcon />}
                              label="logged"
                              title={SENSITIVE_FIELD_CATEGORY_LABELS[f.sensitive]}
                              sx={{ height: 20, fontSize: '0.75rem' }}
                            />
                          )}
                        </Stack>
                      }
                    />
                  ))}
                </Box>
              </Box>
            );
          })}
        </Stack>
      </ResponsiveDialog>
    </>
  );
}
