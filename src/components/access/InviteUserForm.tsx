'use client';

// A6 · Invite user — S-AC-02 · /users/new · F-ADM-02, F-ADM-04 · US-ADMIN-002, 003.
// U3 User type * (•) Employee user (•) External administrator (SA only).
// Employee user (W2-003): U4 Linked employee * (employees without a user) → U1 Login email 🔒 =
// work email · U2 Display name (default preferred + surname) · U5 Roles (SA only: Admin / Super
// Admin) · U7 Access start (default today) · Invite (•) Send now (•) Schedule dd/mm/yyyy.
// External administrator (SA): U1 Login email * · U2 Display name * · U9 Service provider * ·
// U5 Roles 🔒 Admin · U7 Access start * · U8 Access end * (auto-expiry) + note. SEND INVITE → N-50.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Checkbox from '@mui/material/Checkbox';
import TextField from '@mui/material/TextField';
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
import type { InvitableEmployee, InvitableEmployees } from '@/server/contracts/users';
import { inviteUser } from '@/server/actions/users';
import ErrorSummary from '../forms/ErrorSummary';
import { DateInput, FormGrid, FullRow, RadioInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import StatusChip from '../StatusChip';
import { useToast } from '../ToastProvider';
import AccessWindowFields from './AccessWindowFields';
import { formatDate, todayMyt } from '@/lib/format';
import { stickyBarSx } from '../forms/stickyBar';

type Ext = { loginEmail: string; displayName: string; serviceProvider: string; accessStartDate: string; accessEndDate: string };
type Emp = { employee: InvitableEmployee | null; displayName: string; admin: boolean; superAdmin: boolean; accessStartDate: string; sendMode: 'now' | 'schedule'; scheduledSendDate: string };

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
  const emptyEmp: Emp = { employee: null, displayName: '', admin: false, superAdmin: false, accessStartDate: todayMyt(), sendMode: 'now', scheduledSendDate: '' };
  const [emp, setEmp] = React.useState<Emp>(emptyEmp);
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const [guard, setGuard] = React.useState(false);
  const dirty = JSON.stringify(ext) !== JSON.stringify(empty) || emp.employee !== null;
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

  const submitEmployee = async () => {
    const e: Record<string, string> = {};
    if (!emp.employee) e.employeeId = 'Select the employee.';
    if (!emp.accessStartDate) e.accessStartDate = 'Enter a date.';
    if (emp.sendMode === 'schedule' && !emp.scheduledSendDate) e.scheduledSendDate = 'Choose the send date.';
    setLocal(e);
    if (Object.keys(e).length) return;
    const roles = isSuperAdmin ? ([emp.admin && 'ADM', emp.superAdmin && 'SA'].filter(Boolean) as ('ADM' | 'SA')[]) : [];
    const res = await runner.run(
      () =>
        inviteUser({
          userType: 'employee',
          employeeId: emp.employee!.employeeId,
          displayName: emp.displayName,
          roles,
          accessStartDate: emp.accessStartDate,
          sendMode: emp.sendMode,
          scheduledSendDate: emp.sendMode === 'schedule' ? emp.scheduledSendDate : undefined,
        }),
      { refresh: false },
    );
    if (res?.ok) {
      const r = res as unknown as { userId: string; emailSent: boolean; message: string };
      if (emp.sendMode === 'schedule') toast.success(r.message || `Invitation scheduled for ${formatDate(emp.scheduledSendDate)}.`);
      else if (r.emailSent) toast.success(r.message || `Invitation sent to ${emp.employee!.workEmail}.`);
      else toast.info(r.message || 'Account created, but the invitation email could not be sent. Use RESEND INVITE later.');
      router.push(`/users/${r.userId}`);
    }
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (userType === 'employee') return submitEmployee();
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
          labels={{ employeeId: 'Linked employee', loginEmail: 'Login email', displayName: 'Display name', serviceProvider: 'Service provider', accessStartDate: 'Access start', accessEndDate: 'Access end', scheduledSendDate: 'Send on' }}
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
              {!employeeAvailable ? (
                <Alert severity="info" variant="outlined">
                  {invitable.message ?? 'Inviting employees is available once employee records exist.'}
                </Alert>
              ) : (
                <FormGrid>
                  <FullRow>
                    <Autocomplete
                      options={invitable.rows}
                      value={emp.employee}
                      getOptionLabel={(o) => `${o.name} (${o.employeeNo})`}
                      isOptionEqualToValue={(a, b) => a.employeeId === b.employeeId}
                      onChange={(_e, v) => setEmp({ ...emp, employee: v, displayName: v?.suggestedDisplayName ?? '' })}
                      noOptionsText="Every employee already has a user account."
                      renderOption={(props, o) => {
                        const { key, ...rest } = props as typeof props & { key: React.Key };
                        return (
                          <Box component="li" key={key} {...rest}>
                            <Box>
                              <Typography variant="body2">
                                {o.name} ({o.employeeNo})
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {o.workEmail}
                                {o.joinDate ? ` · joins ${formatDate(o.joinDate)}` : ''}
                              </Typography>
                            </Box>
                          </Box>
                        );
                      }}
                      renderInput={(params) => <TextField {...params} label="Linked employee" required error={Boolean(errors.employeeId)} helperText={errors.employeeId ?? 'Employees without a user account.'} />}
                    />
                  </FullRow>
                  <TextInput label="Login email" value={emp.employee?.workEmail ?? ''} onChange={() => undefined} locked="The employee's work email (change it on the employee record)." />
                  <TextInput label="Display name" value={emp.displayName} onChange={(v) => setEmp({ ...emp, displayName: v })} maxLength={100} error={errors.displayName} helper="Default: preferred name + surname." />
                  <FullRow>
                    <Typography variant="caption" color="text.secondary" component="p">
                      Roles
                    </Typography>
                    {isSuperAdmin ? (
                      <Stack direction="row" spacing={2} flexWrap="wrap">
                        <FormControlLabel control={<Checkbox checked={emp.admin} onChange={(e) => setEmp({ ...emp, admin: e.target.checked })} />} label="Admin" />
                        <FormControlLabel control={<Checkbox checked={emp.superAdmin} onChange={(e) => setEmp({ ...emp, superAdmin: e.target.checked })} />} label="Super Admin" />
                      </Stack>
                    ) : (
                      <Typography variant="body2">Employee (Manager is derived from reporting lines). Only a Super Admin assigns Admin roles.</Typography>
                    )}
                    {emp.superAdmin && (
                      <Alert severity="warning" variant="outlined" sx={{ mt: 1 }}>
                        Assigning Super Admin gives full access including audit logs.
                      </Alert>
                    )}
                  </FullRow>
                  <DateInput label="Access start" required value={emp.accessStartDate} onChange={(v) => setEmp({ ...emp, accessStartDate: v })} error={errors.accessStartDate} helper="Default today." />
                  <Box />
                  <RadioInput
                    label="Invite"
                    value={emp.sendMode}
                    onChange={(v) => setEmp({ ...emp, sendMode: v as 'now' | 'schedule' })}
                    options={[
                      { value: 'now', label: 'Send now' },
                      { value: 'schedule', label: 'Schedule' },
                    ]}
                  />
                  {emp.sendMode === 'schedule' ? (
                    <DateInput label="Send on" required value={emp.scheduledSendDate} onChange={(v) => setEmp({ ...emp, scheduledSendDate: v })} minDate={todayMyt()} error={errors.scheduledSendDate} />
                  ) : (
                    <Box />
                  )}
                </FormGrid>
              )}
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

        <Stack direction="row" spacing={1} justifyContent="flex-end" sx={stickyBarSx}>
          <Button variant="outlined" color="inherit" onClick={() => (dirty ? setGuard(true) : router.push('/users'))} disabled={runner.saving}>
            Cancel
          </Button>
          <Button variant="contained" type="submit" loading={runner.saving} disabled={userType === 'external' ? !isSuperAdmin : !employeeAvailable}>
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
