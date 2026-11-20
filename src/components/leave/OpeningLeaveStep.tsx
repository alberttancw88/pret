'use client';

// E2 step 5 · Opening leave — F-LV-35 · US-LEAVE-040 (wireframes-employees E2): only when the join date is before today in
// the current leave year. Table per active leave type with entitlement this year (computed, 🔒) · Taken this year (½ steps)
// · Carry-forward remaining (types that carry forward) + CF expiry (default 31/03) · Replacement credits (date worked,
// days, expiry — add rows) · Paternity occurrences used (male). The form comes from fetchOpeningLeaveForm (registered
// action — it recomputes when the join date / service date / grade / gender change); the values go into
// createEmployee({ openingLeave }) so the employee and the opening ledger rows are created together.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockIcon from '@mui/icons-material/Lock';
import type { OpeningLeaveForm, OpeningLeaveInput } from '@/server/contracts/leave';
import { fetchOpeningLeaveForm } from '@/server/actions/leave';
import { DateInput, NumberInput } from '../forms/fields';
import { formatDate } from '@/lib/format';
import { formatDays } from './common';

export type OpeningLeaveValue = {
  rows: Record<string, { taken: string; carryForward: string; cfExpiry: string }>;
  credits: { key: string; dateWorked: string; days: string; expiryDate: string }[];
  paternityUsed: string;
};
export const EMPTY_OPENING: OpeningLeaveValue = { rows: {}, credits: [], paternityUsed: '0' };

/** Payload for createEmployee.openingLeave — undefined when the step does not apply or nothing was entered. */
export function openingLeavePayload(v: OpeningLeaveValue, form: OpeningLeaveForm | null): OpeningLeaveInput | undefined {
  if (!form || !form.applicable) return undefined;
  const rows = form.rows
    .map((r) => {
      const x = v.rows[r.leaveType.id];
      const taken = Number(x?.taken || 0);
      const cf = Number(x?.carryForward || 0);
      return { leaveTypeId: r.leaveType.id, takenThisYear: taken, carryForward: r.carryForwardAllowed ? cf : 0, carryForwardExpiry: cf > 0 ? x?.cfExpiry || form.defaultCfExpiry : null };
    })
    .filter((r) => r.takenThisYear > 0 || r.carryForward > 0);
  const credits = v.credits.filter((c) => c.dateWorked).map((c) => ({ dateWorked: c.dateWorked, days: Number(c.days || 1), expiryDate: c.expiryDate }));
  const paternity = Number(v.paternityUsed || 0);
  if (!rows.length && !credits.length && !paternity) return undefined;
  return { rows, credits, paternityOccurrencesUsed: paternity };
}

let k = 0;

export default function OpeningLeaveStep({
  joinDate,
  continuousServiceDate,
  gradeId,
  gender,
  value,
  onChange,
  onForm,
  errors,
}: {
  joinDate: string;
  continuousServiceDate: string;
  gradeId: string;
  gender: string;
  value: OpeningLeaveValue;
  onChange: (v: OpeningLeaveValue) => void;
  /** the wizard keeps the loaded form to build the payload */
  onForm: (f: OpeningLeaveForm | null) => void;
  errors?: Record<string, string>;
}) {
  const [form, setForm] = React.useState<OpeningLeaveForm | null>(null);
  const [state, setState] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joinDate)) {
      setForm(null);
      onForm(null);
      return;
    }
    let alive = true;
    setState('loading');
    (async () => {
      try {
        const res = await fetchOpeningLeaveForm({
          joinDate,
          continuousServiceDate: continuousServiceDate || null,
          gradeId: gradeId || null,
          gender: gender === 'male' || gender === 'female' ? gender : undefined,
        });
        if (!alive) return;
        if (res.ok) {
          setForm(res);
          onForm(res);
          setState('idle');
        } else setState('error');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joinDate, continuousServiceDate, gradeId, gender, retry]);

  const setRow = (id: string, p: Partial<OpeningLeaveValue['rows'][string]>) =>
    onChange({ ...value, rows: { ...value.rows, [id]: { ...(value.rows[id] ?? { taken: '', carryForward: '', cfExpiry: '' }), ...p } } });

  if (!joinDate) return <Alert severity="info">Enter the join date (step 3) first.</Alert>;
  if (state === 'loading' && !form) return <Typography color="text.secondary">Working out this year&apos;s entitlements…</Typography>;
  if (state === 'error')
    return (
      <Alert severity="error" action={<Button onClick={() => setRetry((n) => n + 1)}>Retry</Button>}>
        Couldn&apos;t load the opening-leave form.
      </Alert>
    );
  if (!form) return null;
  if (!form.applicable)
    return (
      <Alert severity="info" variant="outlined">
        Not needed — the join date ({formatDate(joinDate)}) is not before today in the {form.year} leave year. Continue to review.
      </Alert>
    );

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary">
        Mid-year joiner: enter leave already taken this year and carry-forward remaining (as on the previous system). They are recorded as “Opening balance”
        entries in the ledger. Leave blank for none.
      </Typography>
      {errors && Object.keys(errors).length > 0 && (
        <Alert severity="error">
          {Object.values(errors).map((e) => (
            <div key={e}>{e}</div>
          ))}
        </Alert>
      )}
      <TableContainer>
        <Table size="small" aria-label="Opening leave per type" sx={{ minWidth: 560 }}>
          <TableHead>
            <TableRow>
              <TableCell>Leave type</TableCell>
              <TableCell align="right">
                Entitlement {form.year} <LockIcon sx={{ fontSize: 14, verticalAlign: 'middle' }} />
              </TableCell>
              <TableCell>Taken this year</TableCell>
              <TableCell>Carry-forward remaining</TableCell>
              <TableCell>CF expiry</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {form.rows.map((r) => {
              const x = value.rows[r.leaveType.id];
              return (
                <TableRow key={r.leaveType.id}>
                  <TableCell>{r.leaveType.name}</TableCell>
                  <TableCell align="right" className="pret-tnum">
                    {formatDays(r.entitlementThisYear)}
                  </TableCell>
                  <TableCell>
                    <TextField size="small" type="number" value={x?.taken ?? ''} onChange={(e) => setRow(r.leaveType.id, { taken: e.target.value })} slotProps={{ htmlInput: { step: 0.5, min: 0, 'aria-label': `${r.leaveType.name} taken this year` } }} sx={{ width: 110 }} />
                  </TableCell>
                  <TableCell>
                    {r.carryForwardAllowed ? (
                      <TextField size="small" type="number" value={x?.carryForward ?? ''} onChange={(e) => setRow(r.leaveType.id, { carryForward: e.target.value })} slotProps={{ htmlInput: { step: 0.5, min: 0, 'aria-label': `${r.leaveType.name} carry-forward remaining` } }} sx={{ width: 110 }} />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    {r.carryForwardAllowed && Number(x?.carryForward || 0) > 0 ? (
                      <Box sx={{ width: 170 }}>
                        <DateInput label="CF expiry" value={x?.cfExpiry || form.defaultCfExpiry} onChange={(v) => setRow(r.leaveType.id, { cfExpiry: v })} />
                      </Box>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Box>
        <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
          Replacement credits
        </Typography>
        {value.credits.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            None.
          </Typography>
        )}
        <Stack spacing={1}>
          {value.credits.map((c, i) => (
            <Stack key={c.key} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <DateInput label="Date worked" required value={c.dateWorked} onChange={(v) => onChange({ ...value, credits: value.credits.map((y, j) => (j === i ? { ...y, dateWorked: v } : y)) })} />
              <TextField select size="small" label="Days" value={c.days} onChange={(e) => onChange({ ...value, credits: value.credits.map((y, j) => (j === i ? { ...y, days: e.target.value } : y)) })} sx={{ width: 110 }}>
                <MenuItem value="1">1.0</MenuItem>
                <MenuItem value="0.5">0.5</MenuItem>
              </TextField>
              <DateInput label="Expiry" required value={c.expiryDate} onChange={(v) => onChange({ ...value, credits: value.credits.map((y, j) => (j === i ? { ...y, expiryDate: v } : y)) })} />
              <IconButton aria-label={`Remove credit ${i + 1}`} onClick={() => onChange({ ...value, credits: value.credits.filter((_y, j) => j !== i) })}>
                <DeleteOutlineIcon />
              </IconButton>
            </Stack>
          ))}
        </Stack>
        <Button startIcon={<AddIcon />} sx={{ mt: 1 }} onClick={() => onChange({ ...value, credits: [...value.credits, { key: `c${++k}`, dateWorked: '', days: '1', expiryDate: '' }] })}>
          Add credit
        </Button>
      </Box>

      {form.paternityTypeId && gender === 'male' && (
        <Box sx={{ maxWidth: 280 }}>
          <NumberInput label="Paternity occurrences used" value={value.paternityUsed} onChange={(v) => onChange({ ...value, paternityUsed: v })} min={0} max={5} helper="Counts toward the 5 per employment (BR-LV-46)." />
        </Box>
      )}
    </Stack>
  );
}
