'use client';

// Set password after "Forgot password" (S-GL-03, reset variant) — wireframes.md G3.
// New password * (live policy ticks, same rules as accept-invite) · Confirm password *.
// Invalid/expired/used link: "This link is invalid or has expired." [REQUEST A NEW LINK].
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { completePasswordReset } from '@/server/actions/auth';
import { useToast } from '../ToastProvider';
import PasswordPolicy, { passwordMeetsPolicy } from './PasswordPolicy';
import { fieldError } from './types';

export default function ResetPasswordForm({ code, linkError }: { code: string | null; linkError: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [errors, setErrors] = React.useState<{ password?: string; confirm?: string }>({});
  const [linkInvalid, setLinkInvalid] = React.useState(linkError);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const policyId = React.useId();

  if (linkInvalid) {
    return (
      <Stack spacing={2.5}>
        <Typography variant="h4" component="h1">
          Reset your password
        </Typography>
        <Alert severity="error" variant="outlined" role="alert">
          <AlertTitle>This link is invalid or has expired.</AlertTitle>
          Reset links work once and expire after 1 hour.
        </Alert>
        <Button component={NextLink} href="/forgot-password" variant="contained" sx={{ minHeight: 48 }}>
          Request a new link
        </Button>
        <Button component={NextLink} href="/login" variant="text" sx={{ textTransform: 'none', alignSelf: 'flex-start', px: 1, ml: -1 }}>
          Back to sign in
        </Button>
      </Stack>
    );
  }

  const onSubmit = (ev: React.FormEvent) => {
    ev.preventDefault();
    setFormError(null);
    const e: typeof errors = {};
    if (!password) e.password = 'Enter a new password.';
    else if (!passwordMeetsPolicy(password)) e.password = "Password doesn't meet the requirements below.";
    if (!confirm) e.confirm = 'Confirm your new password.';
    else if (confirm !== password) e.confirm = "Passwords don't match.";
    setErrors(e);
    if (Object.keys(e).length) return;

    startTransition(async () => {
      const res = await completePasswordReset(code ? { password, code } : { password });
      if (res.ok) {
        toast.success('Password changed. Other sessions have been signed out.');
        router.replace('/');
        router.refresh();
        return;
      }
      const pw = fieldError(res, 'password');
      if (fieldError(res, 'code') || (!pw && /invalid|expired/i.test(res.error ?? ''))) {
        setLinkInvalid(true);
        return;
      }
      setErrors({ password: pw });
      if (!pw) setFormError(res.error || 'Something went wrong. Your changes were not saved.');
    });
  };

  const visibility = (
    <InputAdornment position="end">
      <IconButton onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide passwords' : 'Show passwords'} aria-pressed={show} edge="end">
        {show ? <VisibilityOffOutlinedIcon /> : <VisibilityOutlinedIcon />}
      </IconButton>
    </InputAdornment>
  );

  return (
    <Box component="form" onSubmit={onSubmit} noValidate aria-busy={pending}>
      <Typography variant="h4" component="h1" sx={{ mb: 1 }}>
        Reset your password
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Choose a new password. You&apos;ll stay signed in here; other sessions will be signed out.
      </Typography>
      <Stack spacing={2.5}>
        <TextField
          label="New password"
          required
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={!!errors.password}
          helperText={errors.password}
          disabled={pending}
          size="medium"
          autoFocus
          slotProps={{ input: { endAdornment: visibility }, htmlInput: { 'aria-describedby': policyId } }}
        />
        <PasswordPolicy password={password} id={policyId} />
        <TextField
          label="Confirm password"
          required
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onBlur={() => confirm && confirm !== password && setErrors((x) => ({ ...x, confirm: "Passwords don't match." }))}
          error={!!errors.confirm}
          helperText={errors.confirm}
          disabled={pending}
          size="medium"
        />
        {formError && (
          <Alert severity="error" variant="outlined" role="alert">
            {formError}
          </Alert>
        )}
        <Button type="submit" variant="contained" fullWidth loading={pending} sx={{ minHeight: 48 }}>
          Set password
        </Button>
      </Stack>
    </Box>
  );
}
