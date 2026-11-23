'use client';

// Runs a Server Action that returns the ActionResult shape
//   { ok: true, … } | { ok: false, error, fieldErrors? }
// and keeps saving / error / fieldErrors state for the form (FR-G-07: submit disabled while
// saving, entered data kept on failure). On success it shows the toast and refreshes the
// server-rendered data (router.refresh) so lists and cards re-read from the server.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '../ToastProvider';
import { announceSessionEnded, SESSION_ENDED_MESSAGE } from './unsaved';

export type ActionFailShape = { ok: false; error: string; fieldErrors?: Record<string, string> };
export type ActionOkShape = { ok: true };
export type AnyActionResult = ActionOkShape | ActionFailShape;

export type RunOptions = {
  /** Toast text on success; omit for no toast. */
  success?: string | ((result: ActionOkShape & Record<string, unknown>) => string);
  /** Re-read server data after success (default true). */
  refresh?: boolean;
};

export function useActionRunner() {
  const router = useRouter();
  const toast = useToast();
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const reset = React.useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  const run = React.useCallback(
    async <R extends AnyActionResult>(fn: () => Promise<R>, opts: RunOptions = {}): Promise<R | null> => {
      setSaving(true);
      setError(null);
      setFieldErrors({});
      try {
        const result = await fn();
        if (result.ok) {
          const msg = typeof opts.success === 'function' ? opts.success(result as ActionOkShape & Record<string, unknown>) : opts.success;
          if (msg) toast.success(msg);
          if (opts.refresh !== false) router.refresh();
        } else {
          // G9: the server says the session is gone — the shell keeps the page's unsaved
          // entries and shows "Your session has ended" with SIGN IN.
          if (result.error === SESSION_ENDED_MESSAGE) announceSessionEnded();
          setError(result.error);
          setFieldErrors(result.fieldErrors ?? {});
        }
        return result;
      } catch {
        setError('Something went wrong. Your changes were not saved.');
        return null;
      } finally {
        setSaving(false);
      }
    },
    [router, toast],
  );

  return { run, saving, error, fieldErrors, reset, setError, setFieldErrors };
}
