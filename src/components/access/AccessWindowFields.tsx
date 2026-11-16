'use client';

// U7 Access start * / U8 Access end (required for External — F-ADM-04, auto-expiry).
// Used on A6 (invite) and A7 (access window card / EXTEND ACCESS).
import * as React from 'react';
import Grid from '@mui/material/Grid';
import { DateInput } from '../forms/fields';

export type AccessWindowValue = { accessStartDate: string; accessEndDate: string };

export default function AccessWindowFields({
  value,
  onChange,
  external,
  errors = {},
  lockStart,
  locked,
}: {
  value: AccessWindowValue;
  onChange: (v: AccessWindowValue) => void;
  external: boolean;
  errors?: Record<string, string>;
  /** Start date is fixed once the user has signed in. */
  lockStart?: string | false;
  locked?: string | false;
}) {
  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DateInput
          label="Access start"
          required
          value={value.accessStartDate}
          onChange={(v) => onChange({ ...value, accessStartDate: v })}
          error={errors.accessStartDate}
          helper="Default today"
          locked={locked || lockStart}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <DateInput
          label="Access end"
          required={external}
          value={value.accessEndDate}
          onChange={(v) => onChange({ ...value, accessEndDate: v })}
          minDate={value.accessStartDate || undefined}
          error={errors.accessEndDate}
          helper={
            external
              ? 'Access expires automatically after this date. Super Admins are warned 30 and 7 days before.'
              : 'Portal access end (set from the separation record for leavers).'
          }
          locked={locked}
        />
      </Grid>
    </Grid>
  );
}
