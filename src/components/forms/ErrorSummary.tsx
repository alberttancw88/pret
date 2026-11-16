'use client';

// "Can't submit yet" summary card at the top of a form (components.md §2, interaction-notes §3).
// Lists the server message and every field error; focus moves here on a failed submit.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';

export type ErrorSummaryProps = {
  error?: string | null;
  fieldErrors?: Record<string, string>;
  /** Field key → human label, so the list reads "Code: already in use". */
  labels?: Record<string, string>;
  title?: string;
};

export default function ErrorSummary({ error, fieldErrors = {}, labels = {}, title = "Can't save yet" }: ErrorSummaryProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const entries = Object.entries(fieldErrors);
  const visible = Boolean(error) || entries.length > 0;

  React.useEffect(() => {
    if (visible) ref.current?.focus();
  }, [visible, error, entries.length]);

  if (!visible) return null;
  return (
    <Alert ref={ref} tabIndex={-1} severity="error" variant="outlined" sx={{ mb: 2 }} role="alert">
      <AlertTitle>{title}</AlertTitle>
      {error && entries.length === 0 && error}
      {entries.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {entries.map(([k, msg]) => (
            <li key={k}>
              {labels[k] ? `${labels[k]}: ` : ''}
              {msg}
            </li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
