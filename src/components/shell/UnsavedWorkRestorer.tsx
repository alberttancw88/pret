'use client';

// G9 · US-ADMIN-014 — after signing in again the user lands back on the page they were on;
// the entries they had not saved (kept in this tab's sessionStorage by IdleTimeout) are fed
// back into the form fields, with a notice and DISCARD. Only for the same user and URL.
import * as React from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import { clearUnsavedWork, restoreUnsavedWork } from '../forms/unsaved';

export default function UnsavedWorkRestorer({ userId }: { userId: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [restored, setRestored] = React.useState(0);

  React.useEffect(() => {
    setRestored(0);
    // Let the page's form mount (and read its server data) before filling it in.
    const t = window.setTimeout(() => setRestored(restoreUnsavedWork(userId)), 400);
    return () => window.clearTimeout(t);
  }, [pathname, search, userId]);

  if (!restored) return null;
  return (
    <Alert
      severity="info"
      role="status"
      sx={{ mb: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => {
            clearUnsavedWork();
            window.location.reload();
          }}
        >
          Discard
        </Button>
      }
    >
      We filled in the entries you hadn&apos;t saved before your session ended. Check them, then save.
    </Alert>
  );
}
