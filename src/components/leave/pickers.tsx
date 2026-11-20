'use client';

// Pickers for the leave screens, each backed by a registered Server Action:
//   LeaveEmployeePicker → searchLeaveEmployees [ADM, SA] — own record excluded (L2, L5, L6, L7 batch);
//     L2 includes Separated employees tagged "Separated — HR only".
//   ApproverPicker → searchApproverOptions [MGR, ADM, SA] — active employee users and internal Admins (L14, G6).
//   ColleaguePicker → searchColleagues [EMP, MGR, ADM, SA] — listed colleagues, caller excluded (P2 LA15 cover person, Q-F1).
import * as React from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { ColleagueOption, LeaveEmployeeOption } from '@/server/contracts/leave';
import type { ApproverOption } from '@/server/contracts/approvals';
import { searchColleagues, searchLeaveEmployees } from '@/server/actions/leave';
import { searchApproverOptions } from '@/server/actions/approvals';

export type PickedPerson = { id: string; employeeNo: string | null; name: string; detail?: string | null; tag?: string | null };
const label = (o: PickedPerson) => (o.employeeNo ? `${o.name} (${o.employeeNo})` : o.name);

function useSearch<T>(fn: (q: string) => Promise<T[]>, deps: unknown[]) {
  const [input, setInput] = React.useState('');
  const [options, setOptions] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(async () => {
      let rows: T[] = [];
      try {
        rows = await fn(input.trim());
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, enabled, ...deps]);
  return { setInput, options, loading, enable: () => setEnabled(true) };
}

function renderOption(props: React.HTMLAttributes<HTMLLIElement> & { key?: React.Key }, o: PickedPerson) {
  const { key, ...rest } = props;
  return (
    <Box component="li" key={key} {...rest}>
      <Box>
        <Typography variant="body2">
          {label(o)} {o.tag && <Chip size="small" label={o.tag} variant="outlined" sx={{ ml: 0.5 }} />}
        </Typography>
        {o.detail && (
          <Typography variant="caption" color="text.secondary">
            {o.detail}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

type PickerProps = {
  label: string;
  value: PickedPerson | null;
  onChange: (v: PickedPerson | null) => void;
  required?: boolean;
  error?: string;
  helper?: React.ReactNode;
  disabled?: boolean;
};

function BasePicker({ s, ...p }: PickerProps & { s: { setInput: (v: string) => void; options: PickedPerson[]; loading: boolean; enable: () => void } }) {
  const opts = [...s.options];
  if (p.value && !opts.some((o) => o.id === p.value!.id)) opts.unshift(p.value);
  return (
    <Autocomplete
      options={opts}
      value={p.value}
      disabled={p.disabled}
      loading={s.loading}
      filterOptions={(x) => x}
      getOptionLabel={label}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_e, v) => p.onChange(v)}
      onOpen={s.enable}
      onInputChange={(_e, v, reason) => reason === 'input' && s.setInput(v)}
      renderOption={renderOption}
      noOptionsText="No matches"
      renderInput={(params) => <TextField {...params} label={p.label} required={p.required} error={Boolean(p.error)} helperText={p.error ?? p.helper} />}
    />
  );
}

/** Employees for HR leave actions (own record excluded by the server). */
export function LeaveEmployeePicker({ includeSeparated = false, ...p }: PickerProps & { includeSeparated?: boolean }) {
  const s = useSearch<PickedPerson>(async (q) => {
    const res = await searchLeaveEmployees({ q: q || undefined, includeSeparated, limit: 20 });
    return res.ok
      ? res.rows.map((r: LeaveEmployeeOption) => ({ id: r.id, employeeNo: r.employeeNo, name: r.name, detail: [r.department, r.status].filter(Boolean).join(' · '), tag: r.tag }))
      : [];
  }, [includeSeparated]);
  return <BasePicker s={s} {...p} />;
}

/** Approvers / delegates (value id = app user id). */
export function ApproverPicker({ excludeUserId, ...p }: PickerProps & { excludeUserId?: string | null }) {
  const s = useSearch<PickedPerson>(async (q) => {
    const res = await searchApproverOptions({ q: q || undefined, excludeUserId: excludeUserId ?? undefined, limit: 20 });
    return res.ok
      ? res.rows.map((r: ApproverOption) => ({ id: r.userId, employeeNo: r.employeeNo, name: r.name, detail: r.position, tag: r.isAdmin ? 'Admin' : null }))
      : [];
  }, [excludeUserId]);
  return <BasePicker s={s} {...p} />;
}

/** Colleagues (P2 cover / handover person) — directory-level fields only. */
export function ColleaguePicker(p: PickerProps) {
  const s = useSearch<PickedPerson>(async (q) => {
    const res = await searchColleagues({ q: q || undefined, limit: 20 });
    return res.ok ? res.rows.map((r: ColleagueOption) => ({ id: r.id, employeeNo: r.employeeNo, name: r.name, detail: r.position })) : [];
  }, []);
  return <BasePicker s={s} {...p} />;
}
