'use client';

// Add / edit form in a dialog (bottom sheet on phone) — wireframes §0.3 + §0.5.
// Error summary on top, fields, record footer, [(CANCEL)] [SAVE]. Leaving with unsaved
// changes asks "Discard unsaved changes?" [(KEEP EDITING)] [DISCARD].
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorSummary from './ErrorSummary';
import RecordFooter, { type RecordMeta } from './RecordFooter';

export type FormDialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: () => unknown;
  saving?: boolean;
  submitLabel?: string;
  error?: string | null;
  fieldErrors?: Record<string, string>;
  fieldLabels?: Record<string, string>;
  /** True when the user changed something (drives the discard guard). */
  dirty?: boolean;
  meta?: RecordMeta | null;
  maxWidth?: 'xs' | 'sm' | 'md';
  children: React.ReactNode;
  /** Hide SAVE (read-only view for roles that can't edit). */
  readOnly?: boolean;
};

export default function FormDialog({
  open,
  title,
  onClose,
  onSubmit,
  saving,
  submitLabel = 'Save',
  error,
  fieldErrors,
  fieldLabels,
  dirty,
  meta,
  maxWidth = 'sm',
  children,
  readOnly,
}: FormDialogProps) {
  const [guard, setGuard] = React.useState(false);
  const formId = React.useId();

  const requestClose = () => {
    if (saving) return;
    if (dirty && !readOnly) setGuard(true);
    else onClose();
  };

  return (
    <>
      <ResponsiveDialog
        open={open}
        onClose={requestClose}
        title={title}
        maxWidth={maxWidth}
        disableClose={saving}
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={requestClose} disabled={saving}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button variant="contained" type="submit" form={formId} loading={saving}>
                {saving ? 'Saving…' : submitLabel}
              </Button>
            )}
          </>
        }
      >
        <Box
          component="form"
          id={formId}
          noValidate
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            if (!saving && !readOnly) void onSubmit();
          }}
          sx={{ pt: 1 }}
        >
          <ErrorSummary error={error} fieldErrors={fieldErrors} labels={fieldLabels} />
          <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
            {children}
          </fieldset>
          <RecordFooter meta={meta} />
        </Box>
      </ResponsiveDialog>
      <ConfirmDialog
        open={guard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onClose={() => setGuard(false)}
        onConfirm={() => {
          setGuard(false);
          onClose();
        }}
      />
    </>
  );
}
