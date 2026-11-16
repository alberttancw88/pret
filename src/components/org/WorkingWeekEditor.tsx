'use client';

// WP2 — Monday…Sunday day-type grid (wireframe O6). Each day: (•) Full working day
// (•) Half working day (•) Off day (•) Rest day. BR-ORG-10: at least one rest day per week
// (EA s59) — the editor shows the error live; the database enforces it too.
// Desktop: table with one radio column per day type. Phone: one select per day.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { DAY_TYPES, DAY_TYPE_LABELS, WEEKDAY_INFO, type DayType, type Weekday } from './labels';

export type WeekPattern = Record<Weekday, DayType>; // = contract PatternDays

export const STANDARD_WEEK: WeekPattern = { mon: 'full', tue: 'full', wed: 'full', thu: 'full', fri: 'full', sat: 'off', sun: 'rest' };
export const REST_DAY_ERROR = 'At least one rest day per week is required (EA s59).';

export function hasRestDay(p: WeekPattern): boolean {
  return Object.values(p).includes('rest');
}

export default function WorkingWeekEditor({
  value,
  onChange,
  error,
  readOnly,
}: {
  value: WeekPattern;
  onChange: (v: WeekPattern) => void;
  /** Server error for the grid (e.g. fieldErrors.days). */
  error?: string;
  readOnly?: boolean;
}) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const restMissing = !hasRestDay(value);
  const message = restMissing ? REST_DAY_ERROR : error;
  const set = (day: Weekday, t: DayType) => !readOnly && onChange({ ...value, [day]: t });

  return (
    <Box role="group" aria-label="Working week (Monday to Sunday)" aria-invalid={Boolean(message)}>
      <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
        Working week *
      </Typography>
      {phone ? (
        <Stack spacing={1.5}>
          {WEEKDAY_INFO.map((d) => (
            <TextField
              key={d.key}
              select
              size="medium"
              label={d.label}
              value={value[d.key]}
              onChange={(e) => set(d.key, e.target.value as DayType)}
              slotProps={{ input: { readOnly } }}
            >
              {DAY_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {DAY_TYPE_LABELS[t]}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </Stack>
      ) : (
        <Table size="small" sx={{ '& td, & th': { px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell>Day</TableCell>
              {DAY_TYPES.map((t) => (
                <TableCell key={t} align="center">
                  {DAY_TYPE_LABELS[t]}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {WEEKDAY_INFO.map((d) => (
              <TableRow key={d.key} role="radiogroup" aria-label={d.label}>
                <TableCell component="th" scope="row">
                  {d.label}
                </TableCell>
                {DAY_TYPES.map((t) => (
                  <TableCell key={t} align="center" padding="checkbox">
                    <Radio
                      checked={value[d.key] === t}
                      onChange={() => set(d.key, t)}
                      disabled={readOnly && value[d.key] !== t}
                      slotProps={{ input: { 'aria-label': `${d.label}: ${DAY_TYPE_LABELS[t]}` } }}
                      name={`wp-${d.key}`}
                      value={t}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {message && (
        <Alert severity="error" variant="outlined" sx={{ mt: 1 }} role="alert">
          {message}
        </Alert>
      )}
    </Box>
  );
}
