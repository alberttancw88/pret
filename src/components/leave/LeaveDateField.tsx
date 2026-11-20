'use client';

// Date picker for leave dates (P2 LA4/LA6, P8 RC3): dd/mm/yyyy; public holidays dotted, rest/off days
// greyed, days with own leave underlined — marks from the registered action fetchCalendarMarks
// (the employee's working-week pattern + state PH calendar). Marks are hints; the server decides.
import * as React from 'react';
import Box from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { PickerDay, type PickerDayProps } from '@mui/x-date-pickers/PickerDay';
import dayjs, { type Dayjs } from 'dayjs';
import type { CalendarMarks } from '@/server/contracts/leave';
import { fetchCalendarMarks } from '@/server/actions/leave';
import { addDaysIso } from '@/server/contracts/leave';

type Mark = CalendarMarks['days'][number];

/** Loads marks once for [from, to] (≤ 400 days) for one employee (own when employeeId is empty). */
export function useCalendarMarks(employeeId: string | null | undefined, from: string, to: string): Map<string, Mark> {
  const [marks, setMarks] = React.useState<Map<string, Mark>>(new Map());
  React.useEffect(() => {
    let alive = true;
    const end = to < addDaysIso(from, 399) ? to : addDaysIso(from, 399);
    (async () => {
      try {
        const res = await fetchCalendarMarks({ employeeId: employeeId || undefined, from, to: end });
        if (alive && res.ok) setMarks(new Map(res.days.map((d) => [d.date, d])));
      } catch {
        /* marks are optional hints */
      }
    })();
    return () => {
      alive = false;
    };
  }, [employeeId, from, to]);
  return marks;
}

export default function LeaveDateField({
  label,
  value,
  onChange,
  required,
  error,
  helper,
  minDate,
  maxDate,
  marks,
  readOnly,
  readOnlyReason,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  helper?: React.ReactNode;
  minDate?: string;
  maxDate?: string;
  marks: Map<string, Mark>;
  readOnly?: boolean;
  readOnlyReason?: string;
}) {
  const Day = React.useMemo(() => {
    function MarkedDay(p: PickerDayProps) {
      const iso = (p.day as Dayjs).format('YYYY-MM-DD');
      const m = marks.get(iso);
      const grey = m && (m.kind === 'rest' || m.kind === 'off' || m.kind === 'not_employed');
      const ph = m && (m.kind === 'public_holiday' || m.kind === 'half_public_holiday');
      const day = (
        <PickerDay
          {...p}
          sx={{
            ...(grey && !p.selected ? { color: 'text.disabled', bgcolor: '#F2F3F5' } : {}),
            ...(m?.hasLeave && !p.selected ? { textDecoration: 'underline', textDecorationThickness: 2 } : {}),
            position: 'relative',
          }}
        >
          {(p.day as Dayjs).date()}
          {ph && (
            <Box component="span" aria-hidden sx={{ position: 'absolute', bottom: 3, left: '50%', transform: 'translateX(-50%)', width: 5, height: 5, borderRadius: '50%', bgcolor: p.selected ? '#fff' : '#C2410C' }} />
          )}
        </PickerDay>
      );
      return m && m.label ? (
        <Tooltip title={m.label} enterTouchDelay={0} disableInteractive>
          <span>{day}</span>
        </Tooltip>
      ) : (
        day
      );
    }
    return MarkedDay;
  }, [marks]);

  return (
    <DatePicker
      label={required ? `${label} *` : label}
      value={value ? dayjs(value) : null}
      format="DD/MM/YYYY"
      readOnly={readOnly}
      minDate={minDate ? dayjs(minDate) : undefined}
      maxDate={maxDate ? dayjs(maxDate) : undefined}
      onChange={(v) => onChange(v && v.isValid() ? v.format('YYYY-MM-DD') : '')}
      slots={{ day: Day }}
      slotProps={{
        textField: {
          fullWidth: true,
          error: Boolean(error),
          helperText: error ?? helper ?? (readOnly ? readOnlyReason : undefined),
          sx: readOnly ? { '& .MuiInputBase-root': { bgcolor: '#F7F7F9' } } : undefined,
        },
        openPickerButton: { 'aria-label': `Choose ${label.toLowerCase()}` },
      }}
    />
  );
}
