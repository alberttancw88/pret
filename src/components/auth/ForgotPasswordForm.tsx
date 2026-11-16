'use client';

// Forgot password (S-GL-02) — wireframes.md G2. Same confirmation for any email
// (no account enumeration). Reset links are valid 1 hour (system-design §3.1).
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { requestPasswordReset } from '@/server/actions/auth';
import { fieldError } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_LINK_HOURS = 1;

export default function ForgotPasswordForm() {
  const [email, setEmail] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [sent, setSent] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const em = email.trim();
    if (!em) return setError('Enter your work email.');
    if (!EMAIL_RE.test(em)) return setError('Enter a valid email address.');
    setError(null);
    startTransition(async () => {
      const res = await requestPasswordReset({ email: em.toLowerCase() });
      // Only a field-format error is shown; any other outcome shows the same confirmation.
      const fe = fieldError(res, 'email');
      if (!res.ok && fe) {
        setError(fe);
        return;
      }
      setSent(true);
    });
  };

  return (
    <Box component="form" onSubmit={onSubmit} noValidate aria-busy={pending}>
      <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
        Forgot password
      </Typography>
      {sent ? (
        <Stack spacing={2.5} sx={{ mt: 2 }}>
          <Alert severity="success" role="status">
            If an account exists for this email, a reset link has been sent. The link expires in {RESET_LINK_HOURS} hour
            {RESET_LINK_HOURS === 1 ? '' : 's'}.
          </Alert>
          <Button component={NextLink} href="/login" variant="outlined" color="inherit">
            Back to sign in
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2.5}>
          <Typography variant="body2" color="text.secondary">
            Enter your work email and we&apos;ll send you a link to reset your password.
          </Typography>
          <TextField
            label="Work email"
            required
            type="email"
            autoComplete="username"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={!!error}
            helperText={error}
            disabled={pending}
            size="medium"
            autoFocus
          />
          <Button type="submit" variant="contained" fullWidth loading={pending} sx={{ minHeight: 48 }}>
            Send reset link
          </Button>
          <Button component={NextLink} href="/login" variant="text" sx={{ textTransform: 'none', alignSelf: 'flex-start', px: 1, ml: -1 }}>
            Back to sign in
          </Button>
        </Stack>
      )}
    </Box>
  );
}
