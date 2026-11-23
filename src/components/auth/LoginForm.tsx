'use client';

// Sign in (S-GL-01) — wireframes.md G1, components.md §9.5.
// Generic error for any failure (never says which field); lockout text comes from the server.
// No "Remember me", no sign-up link (invite only).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { signIn } from '@/server/actions/auth';
import { continueUrl, fieldError } from './types';
import { hasUnsavedWork } from '../forms/unsaved';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginForm({
  next,
  privacyNoticePublished = false,
  expired = false,
}: {
  next?: string;
  privacyNoticePublished?: boolean;
  /** G9 — arrived from "Your session has ended" (idle timeout). */
  expired?: boolean;
}) {
  const router = useRouter();
  const [keptWork, setKeptWork] = React.useState(false);
  React.useEffect(() => setKeptWork(expired && hasUnsavedWork()), [expired]);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [errors, setErrors] = React.useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  const validate = () => {
    const e: typeof errors = {};
    const em = email.trim();
    if (!em) e.email = 'Enter your work email.';
    else if (!EMAIL_RE.test(em)) e.email = 'Enter a valid email address.';
    if (!password) e.password = 'Enter your password.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    if (!validate()) return;
    startTransition(async () => {
      const res = await signIn({ email: email.trim().toLowerCase(), password });
      if (res.ok) {
        router.replace(continueUrl(next));
        router.refresh();
        return;
      }
      setFormError(res.error || 'Email or password is incorrect.');
      setErrors({ email: fieldError(res, 'email'), password: fieldError(res, 'password') });
      setPassword('');
    });
  };

  return (
    <Box component="form" onSubmit={onSubmit} noValidate aria-busy={pending}>
      <Typography variant="h4" component="h1" sx={{ mb: 3 }}>
        Sign in
      </Typography>
      {expired && (
        <Alert severity="info" sx={{ mb: 2.5 }}>
          Your session has ended. Sign in again to continue.
          {keptWork ? ' Your unsaved entries will be filled in again on the page you were on.' : ''}
        </Alert>
      )}
      <Stack spacing={2.5}>
        <TextField
          label="Work email"
          required
          type="email"
          autoComplete="username"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => email && !EMAIL_RE.test(email.trim()) && setErrors((x) => ({ ...x, email: 'Enter a valid email address.' }))}
          error={!!errors.email}
          helperText={errors.email}
          disabled={pending}
          size="medium"
          autoFocus
        />
        <TextField
          label="Password"
          required
          type={show ? 'text' : 'password'}
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={!!errors.password}
          helperText={errors.password}
          disabled={pending}
          size="medium"
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShow((s) => !s)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                    aria-pressed={show}
                    edge="end"
                  >
                    {show ? <VisibilityOffOutlinedIcon /> : <VisibilityOutlinedIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        {formError && (
          <Alert severity="error" variant="outlined" role="alert">
            {formError}
          </Alert>
        )}
        <Button type="submit" variant="contained" fullWidth loading={pending} sx={{ minHeight: 48 }}>
          {pending ? 'Signing in…' : 'Sign in'}
        </Button>
        <Stack alignItems="flex-start" spacing={0.5}>
          <Button component={NextLink} href="/forgot-password" variant="text" sx={{ textTransform: 'none', px: 1, ml: -1 }}>
            Forgot password?
          </Button>
          {privacyNoticePublished && (
            <Link component={NextLink} href="/privacy-notice" variant="body2">
              Privacy notice
            </Link>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}
