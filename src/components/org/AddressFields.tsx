'use client';

// Malaysian address block (as PRD B5–B10): line 1 *, line 2, line 3, postcode * (5 digits),
// city *, state * (13 states + 3 FTs), country (Malaysia).
import * as React from 'react';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';
import { SelectInput, TextInput } from '../forms/fields';
import { STATE_OPTIONS } from './labels';

export type AddressValue = {
  line1: string;
  line2: string;
  line3: string;
  postcode: string;
  city: string;
  state: string;
};

export const EMPTY_ADDRESS: AddressValue = { line1: '', line2: '', line3: '', postcode: '', city: '', state: '' };

export default function AddressFields({
  legend,
  value,
  onChange,
  errors = {},
  errorPrefix = '',
  required = true,
  locked,
  stateHelper,
}: {
  legend?: string;
  value: AddressValue;
  onChange: (v: AddressValue) => void;
  /** Field errors keyed `${errorPrefix}line1` etc. */
  errors?: Record<string, string>;
  errorPrefix?: string;
  required?: boolean;
  locked?: string | false;
  stateHelper?: string;
}) {
  const set = (k: keyof AddressValue) => (v: string) => onChange({ ...value, [k]: v });
  const err = (k: keyof AddressValue) => errors[`${errorPrefix}${k}`] ?? errors[`${errorPrefix}${k[0].toUpperCase()}${k.slice(1)}`];
  return (
    <fieldset style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      {legend && (
        <Typography component="legend" variant="subtitle2" sx={{ mb: 1 }}>
          {legend}
          {required ? ' *' : ''}
        </Typography>
      )}
      <Grid container spacing={2}>
        <Grid size={12}>
          <TextInput label="Address line 1" required={required} value={value.line1} onChange={set('line1')} maxLength={150} error={err('line1')} locked={locked} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextInput label="Address line 2" value={value.line2} onChange={set('line2')} maxLength={150} error={err('line2')} locked={locked} />
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextInput label="Address line 3" value={value.line3} onChange={set('line3')} maxLength={150} error={err('line3')} locked={locked} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextInput
            label="Postcode"
            required={required}
            value={value.postcode}
            onChange={(v) => set('postcode')(v.replace(/\D/g, ''))}
            maxLength={5}
            inputMode="numeric"
            error={err('postcode')}
            helper="5 digits"
            locked={locked}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextInput label="City" required={required} value={value.city} onChange={set('city')} maxLength={80} error={err('city')} locked={locked} />
        </Grid>
        <Grid size={{ xs: 12, sm: 4 }}>
          <SelectInput
            label="State"
            required={required}
            value={value.state}
            onChange={set('state')}
            options={STATE_OPTIONS}
            error={err('state')}
            helper={stateHelper}
            locked={locked}
          />
        </Grid>
      </Grid>
    </fieldset>
  );
}
