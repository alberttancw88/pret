'use client';

// A7 · User detail — S-AC-03 · /users/{id} · F-ADM-03/04/05/07/13 · US-ADMIN-004, 005, 007, 013.
// Header: Display name · email · type · status ● · roles + actions by status (never on own account):
// RESEND INVITE (Invited) · UNLOCK (Locked) · SEND PASSWORD RESET · DISABLE (reason) · RE-ENABLE.
// Cards: Account (U1–U4, U9, U15) · Roles (SA toggles, SAVE ROLES) · Access window (U7, U8;
// External: EXTEND ACCESS) · Security (U13 MFA + RESET TWO-FACTOR SA · U14) · Login history list
// (dd/mm/yyyy HH:mm · Result · IP · Device; filters result, date range; EXPORT .CSV).
// Which actions show comes from the server-computed `can` flags; the actions re-check roles.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import {
  LOGIN_OUTCOMES,
  LOGIN_OUTCOME_LABELS,
  USER_TYPE_LABELS,
  type LoginEventRow,
  type LoginHistoryParams,
  type PrivilegedRole,
  type UserDetail,
} from '@/server/contracts/users';
import {
  disableUser,
  enableUser,
  exportLoginHistoryCsv,
  resendInvite,
  resetUserMfa,
  saveUserRoles,
  sendPasswordReset,
  unlockUser,
  updateUserAccessWindow,
  updateUserAccount,
} from '@/server/actions/users';
import PageTitle from '../shell/PageTitle';
import StatusChip from '../StatusChip';
import DateText from '../DateText';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ReasonDialog from '../dialogs/ReasonDialog';
import FormCard from '../forms/FormCard';
import ErrorSummary from '../forms/ErrorSummary';
import { FormGrid, KeyValue, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, MultiSelectFilter } from '../list/FilterFields';
import { useServerList, downloadServerCsv } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import RoleAssignmentPanel from './RoleAssignmentPanel';
import AccessWindowFields from './AccessWindowFields';
import UserRoleChips from './UserRoleChips';
import { LOGIN_HISTORY_FILTERS } from './filters';
import { userStatusLabel } from './labels';
import { formatDateTime } from '@/lib/format';

/** Short device label from a user agent ("Chrome on macOS"); never shows the raw string in the table. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

type Pending = 'resend' | 'unlock' | 'reset' | 'enable' | 'mfa' | null;

export default function UserDetailView({
  user,
  history,
  historyParams,
}: {
  user: UserDetail;
  history: { rows: LoginEventRow[]; total: number } | null;
  historyParams: LoginHistoryParams | null;
}) {
  const toast = useToast();
  const external = user.userType === 'external';

  // ---- Status actions -------------------------------------------------------------
  const actionRunner = useActionRunner();
  const [pending, setPending] = React.useState<Pending>(null);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const runPending = async () => {
    const id = { userId: user.id };
    const map = {
      resend: () => actionRunner.run(() => resendInvite(id), { success: (r) => String((r as { message?: string }).message ?? `Invitation re-sent to ${user.loginEmail}.`) }),
      unlock: () => actionRunner.run(() => unlockUser(id), { success: `${user.displayName} unlocked. They can sign in now.` }),
      reset: () => actionRunner.run(() => sendPasswordReset(id), { success: `Password reset link sent to ${user.loginEmail}.` }),
      enable: () => actionRunner.run(() => enableUser(id), { success: `${user.displayName} re-enabled.` }),
      mfa: () => actionRunner.run(() => resetUserMfa(id), { success: `Two-factor reset. ${user.displayName} must enrol again at next sign-in.` }),
    } as const;
    if (!pending) return;
    const res = await map[pending]();
    if (res?.ok) setPending(null);
  };
  const confirmSpec: Record<Exclude<Pending, null>, { title: string; body: string; label: string; destructive?: boolean }> = {
    resend: { title: `Resend the invitation to ${user.loginEmail}?`, body: 'A new link is emailed; the previous link stops working. Links expire after 72 hours.', label: 'Resend invite' },
    unlock: { title: `Unlock ${user.displayName}?`, body: 'Failed attempts are cleared and the user can sign in immediately.', label: 'Unlock' },
    reset: { title: `Send a password reset link to ${user.loginEmail}?`, body: 'The user chooses a new password from the link. Their current sessions end.', label: 'Send password reset' },
    enable: {
      title: `Re-enable ${user.displayName}?`,
      body: external && user.accessEndDate ? 'Access is restored within the current access window.' : 'The user can sign in again.',
      label: 'Re-enable',
    },
    mfa: {
      title: `Reset two-factor for ${user.displayName}?`,
      body: 'Their authenticator is removed. They must enrol a new one at next sign-in before using Admin functions.',
      label: 'Reset two-factor',
      destructive: true,
    },
  };

  // ---- Account card -------------------------------------------------------------------
  const accInit = React.useMemo(
    () => ({ displayName: user.displayName, loginEmail: user.loginEmail, serviceProvider: user.serviceProvider ?? '' }),
    [user.displayName, user.loginEmail, user.serviceProvider],
  );
  const [acc, setAcc] = React.useState(accInit);
  React.useEffect(() => setAcc(accInit), [accInit]);
  const accRun = useActionRunner();
  const emailEditable = user.can.editAccount && user.status === 'invited';

  // ---- Roles --------------------------------------------------------------------------
  const rolesRun = useActionRunner();
  const saveRoles = async (roles: PrivilegedRole[]) => {
    await rolesRun.run(() => saveUserRoles({ userId: user.id, roles }), {
      success: (r) => {
        const g = (r as { granted?: string[] }).granted ?? [];
        const v = (r as { revoked?: string[] }).revoked ?? [];
        const name = (x: string) => (x === 'SA' ? 'Super Admin' : 'Admin');
        const parts = [...g.map((x) => `${name(x)} granted`), ...v.map((x) => `${name(x)} removed`)];
        return parts.length ? `${parts.join(', ')}. ${user.displayName} and Super Admins are notified.` : 'Roles saved.';
      },
    });
  };

  // ---- Access window ------------------------------------------------------------------
  const winInit = React.useMemo(() => ({ accessStartDate: user.accessStartDate, accessEndDate: user.accessEndDate ?? '' }), [user.accessStartDate, user.accessEndDate]);
  const [win, setWin] = React.useState(winInit);
  React.useEffect(() => setWin(winInit), [winInit]);
  const winRun = useActionRunner();

  // ---- Login history --------------------------------------------------------------------
  const lh = useServerList({ filters: LOGIN_HISTORY_FILTERS });
  const lhCols: ListColumn<LoginEventRow>[] = [
    { key: 'occurredAt', header: 'Date / time', kind: 'date', sortable: false, value: (r) => formatDateTime(r.occurredAt), render: (r) => <DateText value={r.occurredAt} mode="datetime" /> },
    { key: 'outcome', header: 'Result', sortable: false, value: (r) => LOGIN_OUTCOME_LABELS[r.outcome] },
    { key: 'ip', header: 'IP', sortable: false, value: (r) => r.ip ?? '' },
    { key: 'device', header: 'Device', sortable: false, value: (r) => deviceLabel(r.userAgent), render: (r) => <span title={r.userAgent ?? undefined}>{deviceLabel(r.userAgent) || '—'}</span> },
  ];

  const showActions = !user.isSelf;
  const actions: React.ReactNode[] = [];
  if (showActions) {
    if (user.status === 'invited' && user.can.resendInvite) actions.push(<Button key="resend" variant="contained" onClick={() => setPending('resend')}>Resend invite</Button>);
    if (user.status === 'locked' && user.can.unlock) actions.push(<Button key="unlock" variant="contained" onClick={() => setPending('unlock')}>Unlock</Button>);
    if ((user.status === 'disabled' || user.status === 'expired') && user.can.enable)
      actions.push(<Button key="enable" variant="contained" color="success" onClick={() => setPending('enable')}>Re-enable</Button>);
    if (user.status !== 'invited' && user.status !== 'disabled' && user.can.sendPasswordReset)
      actions.push(<Button key="reset" variant="outlined" color="inherit" onClick={() => setPending('reset')}>Send password reset</Button>);
    if (user.status !== 'disabled' && user.can.disable)
      actions.push(<Button key="disable" variant="outlined" color="error" onClick={() => setDisableOpen(true)}>Disable</Button>);
  }

  return (
    <Stack spacing={2}>
      <PageTitle title={user.displayName} breadcrumbs={[{ label: 'Users & access' }, { label: 'Users', href: '/users' }]} />

      {/* Header */}
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between">
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h4" component="h2">
                  {user.displayName}
                </Typography>
                <StatusChip set="user" value={userStatusLabel(user.status)} />
              </Stack>
              <Typography variant="body1" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
                {user.loginEmail} · {USER_TYPE_LABELS[user.userType]}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <UserRoleChips userType={user.userType} roles={user.roles} directReportees={user.directReportees} />
              </Box>
            </Box>
            {actions.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start" justifyContent={{ md: 'flex-end' }}>
                {actions}
              </Stack>
            )}
          </Stack>
          {user.isSelf && (
            <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
              This is your own account. You can&apos;t change your own roles or status.
            </Alert>
          )}
          {user.status === 'disabled' && user.disabledReason && (
            <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>
              Disabled: {user.disabledReason}
            </Alert>
          )}
          {actionRunner.error && !pending && (
            <Box sx={{ mt: 2 }}>
              <ErrorSummary error={actionRunner.error} title="Not done" />
            </Box>
          )}
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <Stack spacing={2}>
            {/* Account */}
            <FormCard
              title="Account"
              lockedReason={null}
              onSave={user.can.editAccount ? () =>
                accRun.run(
                  () =>
                    updateUserAccount({
                      userId: user.id,
                      displayName: acc.displayName,
                      loginEmail: emailEditable ? acc.loginEmail : undefined,
                      serviceProvider: external ? acc.serviceProvider : null,
                    }),
                  { success: 'Account details saved.' },
                ) : undefined}
              saving={accRun.saving}
              dirty={JSON.stringify(acc) !== JSON.stringify(accInit)}
              error={accRun.error}
              fieldErrors={accRun.fieldErrors}
              fieldLabels={{ displayName: 'Display name', loginEmail: 'Login email', serviceProvider: 'Service provider' }}
              meta={{ createdAt: user.createdAt, createdByName: user.createdByName, updatedAt: user.updatedAt, updatedByName: user.updatedByName }}
            >
              <FormGrid>
                <TextInput
                  label="Login email"
                  required
                  value={acc.loginEmail}
                  onChange={(v) => setAcc({ ...acc, loginEmail: v })}
                  maxLength={254}
                  error={accRun.fieldErrors.loginEmail}
                  locked={!emailEditable && (user.can.editAccount ? 'Fixed once the invitation is accepted (sign-in identity).' : 'Read only')}
                />
                <TextInput label="Display name" required value={acc.displayName} onChange={(v) => setAcc({ ...acc, displayName: v })} maxLength={100} error={accRun.fieldErrors.displayName} locked={!user.can.editAccount && 'Only a Super Admin can change this.'} />
                <KeyValue label="User type" value={USER_TYPE_LABELS[user.userType]} />
                {external ? (
                  <TextInput
                    label="Service provider (company)"
                    required
                    value={acc.serviceProvider}
                    onChange={(v) => setAcc({ ...acc, serviceProvider: v })}
                    maxLength={150}
                    error={accRun.fieldErrors.serviceProvider}
                    locked={!user.can.editAccount && 'Only a Super Admin can change this.'}
                  />
                ) : (
                  <KeyValue label="Linked employee" value={user.employeeNo ? `${user.employeeNo}${user.employeeName ? ` · ${user.employeeName}` : ''}` : 'Shown after employee records are added'} />
                )}
                <KeyValue label="Invited by / at" value={user.invitedAt ? `${user.invitedByName ?? 'System'} · ${formatDateTime(user.invitedAt)}` : ''} />
                <KeyValue
                  label="Invitation"
                  value={
                    user.invitation
                      ? `${user.invitation.status[0].toUpperCase()}${user.invitation.status.slice(1)}${
                          user.invitation.status === 'pending' ? ` · expires ${formatDateTime(user.invitation.expiresAt)}` : user.invitation.acceptedAt ? ` · ${formatDateTime(user.invitation.acceptedAt)}` : ''
                        }`
                      : ''
                  }
                />
              </FormGrid>
            </FormCard>

            {/* Access window */}
            <FormCard
              title="Access window"
              subtitle={external ? 'External access expires automatically after the end date. Super Admins are warned 30 and 7 days before.' : undefined}
              lockedReason={user.can.editAccessWindow ? null : user.isSelf ? "You can't change your own access." : 'Only a Super Admin can change this.'}
              onSave={() =>
                winRun.run(() => updateUserAccessWindow({ userId: user.id, accessStartDate: win.accessStartDate, accessEndDate: win.accessEndDate }), {
                  success: user.status === 'expired' ? 'Access extended — the user is active again.' : 'Access window saved.',
                })
              }
              saveLabel={external ? 'Extend access' : 'Save'}
              saving={winRun.saving}
              dirty={JSON.stringify(win) !== JSON.stringify(winInit)}
              error={winRun.error}
              fieldErrors={winRun.fieldErrors}
              fieldLabels={{ accessStartDate: 'Access start', accessEndDate: 'Access end' }}
            >
              <AccessWindowFields external={external} value={win} onChange={setWin} errors={winRun.fieldErrors} locked={!user.can.editAccessWindow && 'Read only'} />
            </FormCard>

            {/* Login history */}
            {history && historyParams && (
              <Card component="section" aria-labelledby="lh-h">
                <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                  <Typography id="lh-h" variant="h5" component="h2" sx={{ mb: 2 }}>
                    Login history
                  </Typography>
                  <ListPage<LoginEventRow>
                    itemName={{ singular: 'sign-in', plural: 'sign-ins' }}
                    filters={[
                      <MultiSelectFilter
                        key="outcome"
                        label="Result"
                        value={lh.draft.outcome}
                        onChange={(v) => lh.setDraftField('outcome', v)}
                        options={LOGIN_OUTCOMES.map((o) => ({ value: o, label: LOGIN_OUTCOME_LABELS[o] }))}
                      />,
                      <DateFilter key="from" label="From" value={lh.draft.from} onChange={(v) => lh.setDraftField('from', v)} />,
                      <DateFilter key="to" label="To" value={lh.draft.to} onChange={(v) => lh.setDraftField('to', v)} />,
                    ]}
                    {...lh.listProps}
                    onSortChange={undefined}
                    onExport={async () => {
                      try {
                        const res = await exportLoginHistoryCsv(historyParams);
                        if (res.ok) downloadServerCsv(res.filename || 'login-history', res.content);
                        else toast.info(res.error);
                      } catch {
                        toast.info('Export failed. Please try again.');
                      }
                    }}
                    columns={lhCols}
                    rows={history.rows}
                    total={history.total}
                    getRowId={(r) => r.id}
                    empty={{ title: 'No sign-ins yet.' }}
                  />
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, lg: 5 }}>
          <Stack spacing={2}>
            {/* Roles */}
            <Card component="section" aria-labelledby="roles-h">
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography id="roles-h" variant="h5" component="h2" sx={{ mb: 2 }}>
                  Roles
                </Typography>
                <RoleAssignmentPanel
                  current={user.roles}
                  isExternal={external}
                  isOwnAccount={user.isSelf}
                  canAssign={user.can.editRoles || user.isSelf}
                  isEmployeeUser={!external}
                  managerReportees={user.directReportees}
                  saving={rolesRun.saving}
                  error={rolesRun.error}
                  onSave={saveRoles}
                />
                {user.roleHistory.length > 0 && (
                  <Box sx={{ mt: 2, overflowX: 'auto' }}>
                    <Typography variant="subtitle2" component="h3" sx={{ mb: 1 }}>
                      Role history
                    </Typography>
                    <Table size="small" aria-label="Role history">
                      <TableHead>
                        <TableRow>
                          <TableCell>Role</TableCell>
                          <TableCell>Granted</TableCell>
                          <TableCell>Removed</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {user.roleHistory.map((h, i) => (
                          <TableRow key={`${h.role}-${h.grantedAt}-${i}`}>
                            <TableCell>{h.role === 'SA' ? 'Super Admin' : 'Admin'}</TableCell>
                            <TableCell>
                              <DateText value={h.grantedAt} mode="datetime" />
                              {h.grantedByName ? ` · ${h.grantedByName}` : ''}
                            </TableCell>
                            <TableCell>
                              {h.revokedAt ? (
                                <>
                                  <DateText value={h.revokedAt} mode="datetime" />
                                  {h.revokedByName ? ` · ${h.revokedByName}` : ''}
                                </>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Security */}
            <Card component="section" aria-labelledby="sec-h">
              <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
                <Typography id="sec-h" variant="h5" component="h2" sx={{ mb: 2 }}>
                  Security
                </Typography>
                <FormGrid>
                  <KeyValue label="Two-factor (MFA)" value={user.mfaEnrolled ? 'Enrolled' : 'Not enrolled'} />
                  <KeyValue label="Last login" value={user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'Never'} />
                  <KeyValue label="Failed attempts" value={String(user.failedLoginCount)} />
                  <KeyValue label="Locked until" value={user.lockedUntil ? formatDateTime(user.lockedUntil) : ''} />
                </FormGrid>
                {user.can.resetMfa && user.mfaEnrolled && !user.isSelf && (
                  <Stack direction="row" justifyContent="flex-end" sx={{ mt: 2 }}>
                    <Button variant="outlined" color="error" onClick={() => setPending('mfa')}>
                      Reset two-factor
                    </Button>
                  </Stack>
                )}
              </CardContent>
            </Card>
          </Stack>
        </Grid>
      </Grid>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? confirmSpec[pending].title : ''}
        body={
          pending ? (
            <>
              {actionRunner.error && <ErrorSummary error={actionRunner.error} title="Not done" />}
              <Typography>{confirmSpec[pending].body}</Typography>
            </>
          ) : null
        }
        confirmLabel={pending ? confirmSpec[pending].label : ''}
        destructive={pending ? Boolean(confirmSpec[pending].destructive) : false}
        onClose={() => {
          actionRunner.reset();
          setPending(null);
        }}
        onConfirm={runPending}
      />
      <ReasonDialog
        open={disableOpen}
        title={`Disable ${user.displayName}?`}
        intro="Their sessions end within 5 minutes and sign-in is refused until re-enabled."
        confirmLabel="Disable user"
        onClose={() => {
          actionRunner.reset();
          setDisableOpen(false);
        }}
        onConfirm={async (reason) => {
          const res = await actionRunner.run(() => disableUser({ userId: user.id, reason }), { success: `${user.displayName} disabled.` });
          if (res?.ok) setDisableOpen(false);
        }}
      />
    </Stack>
  );
}
