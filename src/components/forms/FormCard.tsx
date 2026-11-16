'use client';

// Section card with its own SAVE (company profile, settings sections — wireframes O1, O11).
// When `lockedReason` is set the card is read-only for this user and says why
// ("Only a Super Admin can change this." / "Super Admin setting").
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import ErrorSummary from './ErrorSummary';
import RecordFooter, { type RecordMeta } from './RecordFooter';

export type FormCardProps = {
  title: string;
  subtitle?: React.ReactNode;
  id?: string;
  lockedReason?: string | null;
  onSave?: () => unknown;
  saving?: boolean;
  dirty?: boolean;
  saveLabel?: string;
  error?: string | null;
  fieldErrors?: Record<string, string>;
  fieldLabels?: Record<string, string>;
  meta?: RecordMeta | null;
  /** Extra buttons left of SAVE. */
  actions?: React.ReactNode;
  children: React.ReactNode;
};

export default function FormCard({
  title,
  subtitle,
  id,
  lockedReason,
  onSave,
  saving,
  dirty,
  saveLabel = 'Save',
  error,
  fieldErrors,
  fieldLabels,
  meta,
  actions,
  children,
}: FormCardProps) {
  const headingId = React.useId();
  return (
    <Card id={id} component="section" aria-labelledby={headingId}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: subtitle ? 0.5 : 2 }}>
          <Typography id={headingId} variant="h5" component="h2">
            {title}
          </Typography>
          {lockedReason && <LockIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />}
        </Stack>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        )}
        {lockedReason && (
          <Alert severity="info" variant="outlined" icon={<LockIcon fontSize="inherit" />} sx={{ mb: 2 }}>
            {lockedReason}
          </Alert>
        )}
        <Box
          component={onSave && !lockedReason ? 'form' : 'div'}
          noValidate
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            if (!saving) void onSave?.();
          }}
        >
          <ErrorSummary error={error} fieldErrors={fieldErrors} labels={fieldLabels} />
          <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {children}
          </fieldset>
          <RecordFooter meta={meta} />
          {(actions || (onSave && !lockedReason)) && (
            <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
              {actions}
              {onSave && !lockedReason && (
                <Button variant="contained" type="submit" loading={saving} disabled={dirty === false}>
                  {saving ? 'Saving…' : saveLabel}
                </Button>
              )}
            </Stack>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
