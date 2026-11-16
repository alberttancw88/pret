'use client';

// A6 · Invite user — S-AC-02 · /users/new · F-ADM-02, F-ADM-04 · US-ADMIN-002, 003.
// U3 User type * (•) Employee user (•) External administrator (SA only).
// Employee user (U4 linked employee, U1 work email 🔒, U2, U5 roles SA, U7, send now / schedule) —
// shown but disabled until employee records exist (W2-003).
// External administrator (SA): U1 Login email * · U2 Display name * · U9 Service provider * ·
// U5 Roles 🔒 Admin · U7 Access start * · U8 Access end * (auto-expiry) + note. SEND INVITE → N-50.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { InvitableEmployees } from '@/server/contracts/users';
import { inviteUser } from '@/server/actions/users';
import ErrorSummary from '../forms/ErrorSummary';
import { FormGrid, FullRow, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import StatusChip from '../StatusChip';
import { useToast } from '../ToastProvider';
import AccessWindowFields from './AccessWindowFields';
import { todayMyt } from '@/lib/format';

type Ext = { loginEmail: string; displayName: string; serviceProvider: string; accessStartDate: string; accessEndDate: string };

export default function InviteUserForm({
  isSuperAdmin,
  invitable,
  initialType,
}: {
  isSuperAdmin: boolean;
  invitable: InvitableEmployees;
  initialType: 'employee' | 'external';
}) {
  const router = useRouter();
  const toast = useToast();
  const runner = useActionRunner();
  const [userType, setUserType] = React.useState<'employee' | 'external'>(isSuperAdmin ? initialType : 'employee');
  const empty: Ext = { loginEmail: '', displayName: '', serviceProvider: '', accessStartDate: todayMyt(), accessEndDate: '' };
  const [ext, setExt] = React.useState<Ext>(empty);
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [guard, setGuard] = React.useState(false);
  const dirty = JSON.stringify(ext) !== JSON.stringify(empty);
  const employeeAvailable = invitable.available;
  const errors = { ...runner.fieldErrors, ...local };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext.loginEmail.trim())) e.loginEmail = 'Enter a valid email address.';
    if (!ext.displayName.trim()) e.displayName = 'Display name is required.';
    if (!ext.serviceProvider.trim()) e.serviceProvider = 'Service provider is required.';
    if (!ext.accessStartDate) e.accessStartDate = 'Enter a date.';
    if (!ext.accessEndDate) e.accessEndDate = 'Access end is required for external administrators.';
    else if (ext.accessStartDate && ext.accessEndDate < ext.accessStartDate) e.accessEndDate = 'Access end must be on or after access start.';
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (userType !== 'external') return;
    const e = validate();
    setLocal(e);
    if (Object.keys(e).length) return;
    const res = await runner.run(() => inviteUser({ userType: 'external', ...ext }), { refresh: false });
    if (res?.ok) {
      const r = res as unknown as { userId: string; emailSent: boolean; message: string };
      if (r.emailSent) toast.success(r.message || `Invitation sent to ${ext.loginEmail.trim()}.`);
      else toast.info(r.message || 'Account created, but the invitation email could not be sent. Use RESEND INVITE later.');
      router.push(`/users/${r.userId}`);
    }
  };

  return (
    <Box component="form" noValidate onSubmit={submit}>
      <Stack spacing={2}>
        <ErrorSummary
          error={runner.error}
          fieldErrors={errors}
          title="Can't send the invitation yet"
          labels={{ loginEmail: 'Login email', displayName: 'Display name', serviceProvider: 'Service provider', accessStartDate: 'Access start', accessEndDate: 'Access end' }}
        />
        <Card>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <FormLabel id="ut" required>
              User type
            </FormLabel>
            <RadioGroup aria-labelledby="ut" value={userType} onChange={(e) => setUserType(e.target.value as 'employee' | 'external')}>
              <FormControlLabel value="employee" control={<Radio />} label="Employee user" disabled={!employeeAvailable} />
              <FormControlLabel
                value="external"
                control={<Radio />}
                label={isSuperAdmin ? 'External administrator' : 'External administrator (Super Admin only)'}
                disabled={!isSuperAdmin}
              />
            </RadioGroup>
            {!employeeAvailable && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Employee user: {invitable.message ?? 'available after employee records are added.'}
              </Typography>
            )}
          </CardContent>
        </Card>

        {userType === 'employee' && (
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                Employee user
              </Typography>
              <Alert severity="info" variant="outlined">
                Inviting employees is available after employee records are added (W2-003). The form will then ask for: Linked employee *
                (employees without a user) · Login email 🔒 (work email) · Display name · Roles (Super Admin only: Admin / Super Admin) · Access
                start (default today) · Invite: send now or schedule.
              </Alert>
            </CardContent>
          </Card>
        )}

        {userType === 'external' && isSuperAdmin && (
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                External administrator
              </Typography>
              <FormGrid>
                <TextInput label="Login email" required type="email" value={ext.loginEmail} onChange={(v) => setExt({ ...ext, loginEmail: v })} maxLength={254} error={errors.loginEmail} autoComplete="off" />
                <TextInput label="Display name" required value={ext.displayName} onChange={(v) => setExt({ ...ext, displayName: v })} maxLength={100} error={errors.displayName} />
                <TextInput full label="Service provider (company)" required value={ext.serviceProvider} onChange={(v) => setExt({ ...ext, serviceProvider: v })} maxLength={150} error={errors.serviceProvider} />
                <FullRow>
                  <Typography variant="caption" color="text.secondary" component="p">
                    Roles
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <StatusChip set="role" value="Admin · External" />
                    <Typography variant="body2" color="text.secondary">
                      Fixed — external administrators hold Admin only.
                    </Typography>
                  </Stack>
                </FullRow>
                <FullRow>
                  <AccessWindowFields external value={ext} onChange={(w) => setExt({ ...ext, ...w })} errors={errors} />
                </FullRow>
                <FullRow>
                  <Alert severity="info" variant="outlined">
                    External users never get Employee or Manager access and cannot be a delegate; every record they open is logged.
                  </Alert>
                </FullRow>
              </FormGrid>
            </CardContent>
          </Card>
        )}

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ position: { xs: 'sticky', sm: 'static' }, bottom: 0, bgcolor: { xs: 'background.paper', sm: 'transparent' }, py: { xs: 1.5, sm: 0 } }}>
          <Button variant="outlined" color="inherit" onClick={() => (dirty ? setGuard(true) : router.push('/users'))} disabled={runner.saving}>
            Cancel
          </Button>
          <Button variant="contained" type="submit" loading={runner.saving} disabled={userType !== 'external' || !isSuperAdmin}>
            {runner.saving ? 'Sending…' : 'Send invite'}
          </Button>
        </Stack>
      </Stack>
      <ConfirmDialog
        open={guard}
        title="Discard unsaved changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onClose={() => setGuard(false)}
        onConfirm={() => router.push('/users')}
      />
    </Box>
  );
}
