'use client';

// Two-factor enrol / verify (S-GL-04) — wireframes.md G4.
// Enrol: step 1 QR + manual key, step 2 6-digit code → VERIFY & CONTINUE.
// Verify: 6-digit code → VERIFY. Wrong code: "Code is incorrect or expired."
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { enrollMfa, signOut, verifyMfa } from '@/server/actions/auth';
import ErrorState from '../ErrorState';
import { continueUrl, fieldError } from './types';
import { surface } from '@/theme/palette';

type Enrolment = { factorId?: string; qrCode?: string; secret?: string };

export default function MfaForm({ mode, next }: { mode: 'enrol' | 'verify'; next?: string }) {
  const router = useRouter();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [enrolment, setEnrolment] = React.useState<Enrolment | null>(null);
  const [enrolError, setEnrolError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const startEnrolment = React.useCallback(() => {
    setEnrolError(null);
    startTransition(async () => {
      const res = await enrollMfa();
      if (!res.ok) {
        setEnrolError(res.error || "Couldn't start two-factor set-up.");
        return;
      }
      // The contract only guarantees { ok: true }; enrolment data is read defensively.
      const data = res as typeof res & Enrolment;
      setEnrolment({ factorId: data.factorId, qrCode: data.qrCode, secret: data.secret });
    });
  }, []);

  React.useEffect(() => {
    if (mode === 'enrol') startEnrolment();
  }, [mode, startEnrolment]);

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await verifyMfa({ code, factorId: enrolment?.factorId });
      if (res.ok) {
        router.replace(continueUrl(next));
        router.refresh();
        return;
      }
      setError(fieldError(res, 'code') ?? res.error ?? 'Code is incorrect or expired.');
      setCode('');
    });
  };

  const codeField = (
    <TextField
      label="6-digit code"
      required
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
      error={!!error}
      helperText={error ?? ' '}
      disabled={pending}
      size="medium"
      autoFocus={mode === 'verify'}
      slotProps={{
        htmlInput: {
          inputMode: 'numeric',
          autoComplete: 'one-time-code',
          pattern: '[0-9]{6}',
          maxLength: 6,
          className: 'pret-tnum',
          style: { letterSpacing: '0.3em', fontSize: '1.25rem' },
        },
      }}
    />
  );

  return (
    <Box component="form" onSubmit={onSubmit} noValidate>
      <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
        {mode === 'enrol' ? 'Set up two-factor sign-in' : 'Two-factor verification'}
      </Typography>

      {mode === 'enrol' ? (
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            Admin and Super Admin accounts need an authenticator app (for example Microsoft or Google Authenticator).
          </Typography>
          <Box>
            <Typography variant="subtitle2" component="h2" sx={{ mb: 1 }}>
              Step 1 · Scan with an authenticator app
            </Typography>
            {enrolError ? (
              <ErrorState kind="tile" message={enrolError} onRetry={startEnrolment} />
            ) : enrolment?.qrCode ? (
              <Stack alignItems="center" spacing={1.5}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={enrolment.qrCode}
                  alt="QR code for your authenticator app"
                  width={184}
                  height={184}
                  style={{ border: `1px solid ${surface.border}`, borderRadius: 14, padding: 8, background: surface.paper }}
                />
                {enrolment.secret && (
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" component="p">
                      Can&apos;t scan? Enter this key manually:
                    </Typography>
                    <Typography
                      component="code"
                      variant="body2"
                      sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', userSelect: 'all' }}
                    >
                      {enrolment.secret}
                    </Typography>
                  </Box>
                )}
              </Stack>
            ) : (
              <Stack alignItems="center">
                <Skeleton variant="rectangular" width={184} height={184} aria-label="Loading QR code" />
              </Stack>
            )}
          </Box>
          <Box>
            <Typography variant="subtitle2" component="h2" sx={{ mb: 1.5 }}>
              Step 2 · Enter the code it shows
            </Typography>
            {codeField}
          </Box>
          <Button type="submit" variant="contained" fullWidth loading={pending} disabled={!enrolment && !enrolError} sx={{ minHeight: 48 }}>
            Verify &amp; continue
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            Enter the 6-digit code from your authenticator app.
          </Typography>
          {codeField}
          <Button type="submit" variant="contained" fullWidth loading={pending} sx={{ minHeight: 48 }}>
            Verify
          </Button>
          <Alert severity="info">Lost your device? Ask a Super Admin to reset two-factor.</Alert>
        </Stack>
      )}

      <Box sx={{ mt: 2 }}>
        <Button
          variant="text"
          type="button"
          sx={{ textTransform: 'none', px: 1, ml: -1 }}
          onClick={() =>
            startTransition(async () => {
              await signOut();
              router.replace('/login');
            })
          }
        >
          Sign out
        </Button>
      </Box>
    </Box>
  );
}
