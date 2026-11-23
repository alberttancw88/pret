'use client';

// G6 · S-GL-08 · /account · F-PRT-14, F-NTF-06, F-LV-24 · US-PORTAL-014, US-LEAVE-031
// Tabs: Password · Notifications · Delegation (MGR, ADM, SA — not External) · Two-factor (ADM / SA).
//  Password: Current * · New * · Confirm * · CHANGE PASSWORD → "Password changed. Other sessions have been signed out."
//  Notifications: Event group · Email (toggle; 🔒 "Required" when mandatory, BR-NTF-04) · In-app (always on, 🔒) · SAVE.
//  Delegation: My delegations — Delegate · From · To · Scope · Status · ⋮ END NOW / EDIT (future only) · ADD DELEGATE.
//  Two-factor: status; "Reset requires a Super Admin."
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import {
  ACCOUNT_TAB_LABELS,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  PASSWORD_CHANGED_MESSAGE,
  changePasswordSchema,
  type AccountSettings as AccountSettingsData,
  type AccountTab,
  type NotificationPreferences,
} from '@/server/contracts/portal';
import { DELEGATION_SCOPE_LABELS, DELEGATION_STATE_LABELS, DELEGATION_STATE_TONE, type DelegationRow } from '@/server/contracts/approvals';
import { changePassword, saveNotificationPreferences } from '@/server/actions/portal';
import { endMyDelegation } from '@/server/actions/approvals';
import { ProfileTabs, MiniTable, useTabParam, type TabDef } from '../employees/ui';
import { DelegationDialog } from '../approvals/Delegations';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorSummary from '../forms/ErrorSummary';
import DateText from '../DateText';
import { useToast } from '../ToastProvider';
import { useActionRunner } from '../forms/useActionRunner';
import { formatDate, todayMyt } from '@/lib/format';
import { ToneChip } from './common';

export default function AccountSettings({
  settings,
  preferences,
  delegations,
  selfUserId,
}: {
  settings: AccountSettingsData;
  preferences: NotificationPreferences | null;
  delegations: DelegationRow[] | null;
  selfUserId: string;
}) {
  const tabs: TabDef[] = settings.tabs.map((t) => ({ value: t, label: ACCOUNT_TAB_LABELS[t] }));
  const [tab, setTab] = useTabParam(tabs, 'password');

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Typography variant="h4" component="h2">
            {settings.displayName}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            Sign-in email: {settings.loginEmail}
            {settings.isExternal ? ' · External administrator' : ''}
          </Typography>
        </CardContent>
      </Card>
      <ProfileTabs tabs={tabs} value={tab} onChange={setTab} label="Account settings sections" />
      {(tab as AccountTab) === 'password' && <PasswordTab settings={settings} />}
      {(tab as AccountTab) === 'notifications' && preferences && <NotificationsTab initial={preferences} />}
      {(tab as AccountTab) === 'delegation' && delegations && <DelegationTab rows={delegations} selfUserId={selfUserId} />}
      {(tab as AccountTab) === 'two_factor' && <TwoFactorTab settings={settings} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------
function PasswordField({
  label,
  value,
  onChange,
  error,
  autoComplete,
  describedBy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete: string;
  describedBy?: string;
}) {
  const [show, setShow] = React.useState(false);
  return (
    <TextField
      label={label}
      required
      type={show ? 'text' : 'password'}
      autoComplete={autoComplete}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={Boolean(error)}
      helperText={error}
      size="medium"
      slotProps={{
        htmlInput: { 'aria-describedby': describedBy, maxLength: 200 },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton onClick={() => setShow((s) => !s)} aria-label={show ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={show} edge="end">
                {show ? <VisibilityOffOutlinedIcon /> : <VisibilityOutlinedIcon />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

function PasswordTab({ settings }: { settings: AccountSettingsData }) {
  const toast = useToast();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const policyId = React.useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setDone(null);
    setFormError(null);
    const parsed = changePasswordSchema.safeParse({ currentPassword: current, newPassword: next, confirmPassword: confirm });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0] ?? 'form')] ??= i.message;
      setErrors(fe);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const res = await changePassword({ currentPassword: current, newPassword: next, confirmPassword: confirm });
      if (res.ok) {
        setCurrent('');
        setNext('');
        setConfirm('');
        setDone(res.message || PASSWORD_CHANGED_MESSAGE);
        toast.success(res.message || PASSWORD_CHANGED_MESSAGE);
        return;
      }
      setErrors(res.fieldErrors ?? {});
      setFormError(res.error);
      setCurrent('');
      // Locked out: the server has signed this session out.
      if (/too many unsuccessful/i.test(res.error) || /session has ended/i.test(res.error)) {
        window.setTimeout(() => window.location.assign('/login'), 2500);
      }
    } catch {
      setFormError('Something went wrong. Your password was not changed.');
    } finally {
      setSaving(false);
    }
  };

  const rules = settings.passwordPolicy.rules.length ? settings.passwordPolicy.rules : [];
  const tests: Record<string, (p: string) => boolean> = {
    characters: (p) => p.length >= settings.passwordPolicy.minLength,
    'upper-case': (p) => /[A-Z]/.test(p),
    'lower-case': (p) => /[a-z]/.test(p),
    number: (p) => /[0-9]/.test(p),
    symbol: (p) => /[^A-Za-z0-9]/.test(p),
  };
  const testFor = (rule: string) => Object.entries(tests).find(([k]) => rule.toLowerCase().includes(k))?.[1];

  return (
    <Card>
      <CardContent>
        <Box component="form" onSubmit={submit} noValidate data-no-restore sx={{ maxWidth: 480 }}>
          <Typography variant="h6" component="h2" sx={{ mb: 2 }}>
            Change password
          </Typography>
          <Stack spacing={2.5}>
            {formError && <ErrorSummary error={formError} fieldErrors={errors} labels={{ currentPassword: 'Current password', newPassword: 'New password', confirmPassword: 'Confirm new password' }} />}
            {done && (
              <Alert severity="success" role="status">
                {done}
              </Alert>
            )}
            <PasswordField label="Current password" value={current} onChange={setCurrent} error={errors.currentPassword} autoComplete="current-password" />
            <PasswordField label="New password" value={next} onChange={setNext} error={errors.newPassword} autoComplete="new-password" describedBy={policyId} />
            <Box component="ul" id={policyId} aria-label="Password requirements" sx={{ listStyle: 'none', p: 0, m: 0, mt: -1 }}>
              {rules.map((r) => {
                const ok = testFor(r)?.(next) ?? false;
                return (
                  <Typography key={r} component="li" variant="body2" sx={{ color: ok ? '#0F6B40' : 'text.secondary', py: 0.25 }}>
                    {ok ? '✓' : '○'} {r}
                    <Box component="span" sx={visuallyHidden}>
                      {ok ? ' — met' : ' — not met'}
                    </Box>
                  </Typography>
                );
              })}
            </Box>
            <PasswordField label="Confirm new password" value={confirm} onChange={setConfirm} error={errors.confirmPassword} autoComplete="new-password" />
            <Typography variant="caption" color="text.secondary">
              Changing your password signs you out on every other device. Five wrong current passwords lock the account for 30 minutes.
            </Typography>
            <Box>
              <Button type="submit" variant="contained" loading={saving} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                {saving ? 'Changing…' : 'Change password'}
              </Button>
            </Box>
          </Stack>
        </Box>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notification preferences (F-NTF-06)
// ---------------------------------------------------------------------------
function NotificationsTab({ initial }: { initial: NotificationPreferences }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const [groups, setGroups] = React.useState(initial.groups);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => setGroups(initial.groups), [initial]);
  const dirty = groups.some((g) => g.emailEnabled !== initial.groups.find((x) => x.key === g.key)?.emailEnabled);

  const save = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await saveNotificationPreferences({ groups: groups.map((g) => ({ key: g.key, emailEnabled: g.emailEnabled })) });
      if (res.ok) {
        setGroups(res.preferences.groups);
        toast.success('Notification preferences saved.');
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    } catch {
      setError('Something went wrong. Your preferences were not saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: string, v: boolean) => setGroups((gs) => gs.map((g) => (g.key === key && !g.mandatory ? { ...g, emailEnabled: v } : g)));

  const emailSwitch = (g: (typeof groups)[number]) =>
    g.mandatory ? (
      <Tooltip title={g.lockedReason ?? 'Required'}>
        <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={phone ? 'flex-end' : 'flex-start'}>
          <Switch checked disabled slotProps={{ input: { 'aria-label': `Email for ${g.label}: required` } }} />
          <LockIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
          <Typography variant="caption" color="text.secondary">
            {g.lockedReason ?? 'Required'}
          </Typography>
        </Stack>
      </Tooltip>
    ) : (
      <Switch
        checked={g.emailEnabled}
        onChange={(e) => toggle(g.key, e.target.checked)}
        slotProps={{ input: { 'aria-label': `Email for ${g.label}` } }}
      />
    );
  const inApp = (
    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent={phone ? 'flex-end' : 'flex-start'}>
      <Switch checked disabled slotProps={{ input: { 'aria-label': 'In-app: always on' } }} />
      <LockIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />
    </Stack>
  );

  const byCategory = NOTIFICATION_CATEGORIES.map((c) => ({ c, rows: groups.filter((g) => g.category === c) })).filter((x) => x.rows.length);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2">
          Notification preferences
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          In-app notifications are always on. You can switch off emails for information-only events; emails for items that need your
          action or concern your account&apos;s security are required.
        </Typography>
        {error && (
          <Box sx={{ mb: 2 }}>
            <ErrorSummary error={error} fieldErrors={fieldErrors} labels={Object.fromEntries(groups.map((g) => [`groups.${g.key}`, g.label]))} />
          </Box>
        )}
        {phone ? (
          <Stack spacing={2}>
            {byCategory.map(({ c, rows }) => (
              <Box key={c}>
                <Typography variant="overline" component="h3" color="text.secondary">
                  {NOTIFICATION_CATEGORY_LABELS[c]}
                </Typography>
                <Stack spacing={1}>
                  {rows.map((g) => (
                    <Box key={g.key} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
                      <Typography variant="subtitle2">{g.label}</Typography>
                      <Typography variant="caption" color="text.secondary" component="p">
                        {g.description}
                      </Typography>
                      {fieldErrors[`groups.${g.key}`] && (
                        <Typography variant="caption" color="error" component="p">
                          {fieldErrors[`groups.${g.key}`]}
                        </Typography>
                      )}
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 0.5 }}>
                        <Typography variant="body2">Email</Typography>
                        {emailSwitch(g)}
                      </Stack>
                      <Stack direction="row" justifyContent="space-between" alignItems="center">
                        <Typography variant="body2">In-app</Typography>
                        {inApp}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Box>
            ))}
          </Stack>
        ) : (
          <TableContainer>
            <Table aria-label="Notification preferences" size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Event group</TableCell>
                  <TableCell sx={{ width: 200 }}>Email</TableCell>
                  <TableCell sx={{ width: 120 }}>In-app</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byCategory.map(({ c, rows }) => (
                  <React.Fragment key={c}>
                    <TableRow>
                      <TableCell colSpan={3} sx={{ bgcolor: '#F7F7F9', fontWeight: 600 }}>
                        {NOTIFICATION_CATEGORY_LABELS[c]}
                      </TableCell>
                    </TableRow>
                    {rows.map((g) => (
                      <TableRow key={g.key}>
                        <TableCell>
                          <Typography variant="body2" fontWeight={500}>
                            {g.label}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {g.description}
                          </Typography>
                          {fieldErrors[`groups.${g.key}`] && (
                            <Typography variant="caption" color="error" component="p">
                              {fieldErrors[`groups.${g.key}`]}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>{emailSwitch(g)}</TableCell>
                        <TableCell>{inApp}</TableCell>
                      </TableRow>
                    ))}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
          Email delivery starts with the notifications release (W2-007); your choices are kept until then.
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button variant="outlined" color="inherit" disabled={!dirty || saving} onClick={() => setGroups(initial.groups)}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} loading={saving} disabled={!dirty} sx={{ flex: { xs: 1, sm: 'none' } }}>
            Save
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Delegation (F-LV-24, US-LEAVE-031) — reuses the W2-004 approvals actions
// ---------------------------------------------------------------------------
function DelegationTab({ rows, selfUserId }: { rows: DelegationRow[]; selfUserId: string }) {
  const router = useRouter();
  const r = useActionRunner();
  const [dialog, setDialog] = React.useState<{ row: DelegationRow | null } | null>(null);
  const [ending, setEnding] = React.useState<DelegationRow | null>(null);
  const today = todayMyt();
  const mine = rows.filter((x) => x.approver.id === selfUserId);
  const toMe = rows.filter((x) => x.approver.id !== selfUserId);

  const person = (p: DelegationRow['delegate']) => (p.employeeNo ? `${p.employeeNo} · ${p.name}` : p.name);
  const state = (x: DelegationRow) => <ToneChip label={DELEGATION_STATE_LABELS[x.state]} tone={DELEGATION_STATE_TONE[x.state]} />;
  const common = [
    { key: 'from', header: 'From', render: (x: DelegationRow) => <DateText value={x.validFrom} /> },
    { key: 'to', header: 'To', render: (x: DelegationRow) => <DateText value={x.validTo} /> },
    { key: 'scope', header: 'Scope', render: (x: DelegationRow) => DELEGATION_SCOPE_LABELS[x.scope] },
    { key: 'status', header: 'Status', render: state },
  ];

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ mb: 1.5 }}>
            <Box>
              <Typography variant="h6" component="h2">
                My delegations
              </Typography>
              <Typography variant="body2" color="text.secondary">
                While a delegation is active, your leave and claim approvals also go to the delegate. You can still act on them yourself.
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDialog({ row: null })} sx={{ flexShrink: 0 }}>
              Add delegate
            </Button>
          </Stack>
          <MiniTable<DelegationRow>
            caption="My delegations"
            columns={[{ key: 'delegate', header: 'Delegate', render: (x) => person(x.delegate) }, ...common, { key: 'setBy', header: 'Set by', render: (x) => (x.setBy === 'admin' ? `HR (${x.setByName})` : 'Me') }]}
            rows={mine}
            getRowId={(x) => x.id}
            empty="You have no delegates. Add one before you go on leave."
            rowActions={(x) => (
              <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                {x.canEdit && (
                  <Button size="small" variant="text" onClick={() => setDialog({ row: x })}>
                    Edit
                  </Button>
                )}
                {x.canEnd && (
                  <Button size="small" variant="text" color="error" onClick={() => setEnding(x)}>
                    End now
                  </Button>
                )}
              </Stack>
            )}
          />
        </CardContent>
      </Card>

      {toMe.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
              Delegated to me
            </Typography>
            <MiniTable<DelegationRow>
              caption="Delegated to me"
              columns={[{ key: 'approver', header: 'Approver', render: (x) => person(x.approver) }, ...common]}
              rows={toMe}
              getRowId={(x) => x.id}
            />
          </CardContent>
        </Card>
      )}

      <DelegationDialog
        open={Boolean(dialog)}
        row={dialog?.row ?? null}
        own
        selfUserId={selfUserId}
        minFrom={today}
        onClose={() => {
          setDialog(null);
          router.refresh();
        }}
      />
      <ConfirmDialog
        open={Boolean(ending)}
        title="End this delegation now?"
        body={ending ? `${person(ending.delegate)} stops receiving your approvals today (${formatDate(today)}). Items already decided stay decided.` : undefined}
        confirmLabel="End now"
        destructive
        onClose={() => setEnding(null)}
        onConfirm={async () => {
          if (!ending) return;
          const res = await r.run(() => endMyDelegation({ id: ending.id }), { success: 'Delegation ended.' });
          if (res?.ok) setEnding(null);
        }}
      />
      {r.error && !ending && <Alert severity="error">{r.error}</Alert>}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Two-factor (ADM / SA)
// ---------------------------------------------------------------------------
function TwoFactorTab({ settings }: { settings: AccountSettingsData }) {
  const t = settings.twoFactor;
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
          Two-factor authentication
        </Typography>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ minWidth: 160 }}>
              Status
            </Typography>
            <ToneChip label={t.enrolled ? 'Enrolled' : 'Not enrolled'} tone={t.enrolled ? 'success' : 'warning'} />
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ minWidth: 160 }}>
              Required for your role
            </Typography>
            <Typography variant="body2">{t.required ? 'Yes' : 'No'}</Typography>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="body2" sx={{ minWidth: 160 }}>
              This session
            </Typography>
            <Typography variant="body2">{t.verifiedThisSession ? 'Verified with your authenticator app' : 'Not verified with a code'}</Typography>
          </Stack>
          <Alert severity="info" icon={<LockIcon fontSize="inherit" />}>
            {t.note || 'Reset requires a Super Admin.'} Lost your device? Ask a Super Admin to reset two-factor; you will enrol again at your next
            sign-in.
          </Alert>
        </Stack>
      </CardContent>
    </Card>
  );
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;
