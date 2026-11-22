'use client';

// O11 · System settings — S-OR-11 · /settings · F-ORG-12 · US-ORG-010.
// Left section menu; each section a form card with SAVE. Control settings are Super Admin
// only — Admins see them read-only with 🔒 "Super Admin setting". Every change is audited
// (Config change); the confirmation toast names the setting(s) changed.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import OpenInNewIcon from '@mui/icons-material/ArrowForward';
import type { SystemSettings as Settings } from '@/server/contracts/org';
import {
  saveApprovalSettings,
  saveEmployeeNumberSettings,
  saveEmploymentSettings,
  saveNotificationSettings,
  saveProbationNoticeSettings,
  saveRetentionSettings,
  saveSignInSecuritySettings,
} from '@/server/actions/org';
import FormCard from '../forms/FormCard';
import { ChipsInput, FormGrid, FullRow, KeyValue, NumberInput, SwitchInput, TextInput } from '../forms/fields';
import { useActionRunner, type AnyActionResult } from '../forms/useActionRunner';
import { formatDateTime } from '@/lib/format';

const SA_LOCK = 'Super Admin setting';

const SECTIONS = [
  { id: 'employee-numbers', label: 'Employee numbers' },
  { id: 'probation-notice', label: 'Probation & notice' },
  { id: 'sign-in', label: 'Sign-in & security' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'leave', label: 'Leave' },
  { id: 'claims', label: 'Claims' },
  { id: 'payroll', label: 'Payroll (R1.1)' },
  { id: 'rehire', label: 'Rehire' },
  { id: 'retention', label: 'Retention' },
  { id: 'notifications', label: 'Notifications' },
] as const;

const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** One SA-only section: local state, SAVE, toast naming the changed settings. */
function useSection<V extends Record<string, unknown>>(init: V) {
  const [value, setValue] = React.useState<V>(init);
  const initKey = JSON.stringify(init);
  React.useEffect(() => setValue(init), [initKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const runner = useActionRunner();
  const set = <K extends keyof V>(k: K, v: V[K]) => setValue((p) => ({ ...p, [k]: v }));
  return { value, set, runner, dirty: JSON.stringify(value) !== initKey };
}

const changedToast =
  (labels: Record<string, string>) =>
  (r: { changed?: unknown }): string => {
    const changed = Array.isArray(r.changed) ? (r.changed as string[]) : [];
    return changed.length ? `Saved: ${changed.map((c) => labels[c] ?? c).join(', ')}.` : 'No changes to save.';
  };

function LinkCard({ id, title, body, href, label }: { id: string; title: string; body: string; href: string; label: string }) {
  return (
    <Card id={id} component="section" aria-labelledby={`${id}-h`}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography id={`${id}-h`} variant="h5" component="h2" sx={{ mb: 1 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {body}
        </Typography>
        <Button variant="outlined" color="inherit" endIcon={<OpenInNewIcon />} component={NextLink} href={href}>
          {label}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SystemSettings({ settings }: { settings: Settings }) {
  const lock = settings.canEdit ? null : SA_LOCK;
  const L = lock ?? false;

  const emp = useSection({ employeeNoPrefix: settings.employeeNoPrefix, employeeNoPadding: num(settings.employeeNoPadding), employeeNoNext: num(settings.employeeNoNext) });
  const prob = useSection({
    defaultProbationMonths: num(settings.defaultProbationMonths),
    maxProbationMonths: num(settings.maxProbationMonths),
    noticeWeeksLt2: num(settings.noticeWeeksLt2),
    noticeWeeks2to5: num(settings.noticeWeeks2to5),
    noticeWeeksGe5: num(settings.noticeWeeksGe5),
    inviteLeadDays: num(settings.inviteLeadDays),
  });
  const sec = useSection({
    allowedEmailDomains: settings.allowedEmailDomains,
    idleTimeoutMinEmployee: num(settings.idleTimeoutMinEmployee),
    idleTimeoutMinPrivileged: num(settings.idleTimeoutMinPrivileged),
    lockoutThreshold: num(settings.lockoutThreshold),
    lockoutMinutes: num(settings.lockoutMinutes),
    mfaRequiredPrivileged: settings.mfaRequiredPrivileged,
    inviteLinkHours: num(settings.inviteLinkHours),
  });
  const appr = useSection({
    reminderAfterWorkingDays: num(settings.reminderAfterWorkingDays),
    escalateAfterWorkingDays: num(settings.escalateAfterWorkingDays),
    saBatchApprovalRequired: settings.saBatchApprovalRequired,
  });
  const empl = useSection({ rehireKeepEmployeeNo: settings.rehireKeepEmployeeNo, maxTopOfOrg: num(settings.maxTopOfOrg) });
  const ret = useSection({
    retentionYearsHr: num(settings.retentionYearsHr),
    retentionYearsPayroll: num(settings.retentionYearsPayroll),
    retentionYearsAudit: num(settings.retentionYearsAudit),
    retentionDaysImportFiles: num(settings.retentionDaysImportFiles),
  });
  const ntf = useSection({ hrReplyToEmail: settings.hrReplyToEmail ?? '', directoryShowBirthdays: settings.directoryShowBirthdays });

  const save = <V extends Record<string, unknown>>(s: ReturnType<typeof useSection<V>>, fn: () => Promise<AnyActionResult>, labels: Record<string, string>) =>
    s.runner.run(fn, { success: changedToast(labels) as (r: unknown) => string });

  const LBL = {
    emp: { employeeNoPrefix: 'Prefix', employeeNoPadding: 'Padding', employeeNoNext: 'Next number' },
    prob: {
      defaultProbationMonths: 'Default probation',
      maxProbationMonths: 'Maximum total probation',
      noticeWeeksLt2: 'Notice (< 2 years)',
      noticeWeeks2to5: 'Notice (2 to < 5 years)',
      noticeWeeksGe5: 'Notice (≥ 5 years)',
      inviteLeadDays: 'Invite timing for new hires',
    },
    sec: {
      allowedEmailDomains: 'Allowed login email domains',
      idleTimeoutMinEmployee: 'Idle timeout (employees)',
      idleTimeoutMinPrivileged: 'Idle timeout (Admin / Super Admin)',
      lockoutThreshold: 'Failed attempts before lockout',
      lockoutMinutes: 'Lockout minutes',
      mfaRequiredPrivileged: 'MFA required for privileged roles',
      inviteLinkHours: 'Invitation link validity',
    },
    appr: { reminderAfterWorkingDays: 'Reminder after', escalateAfterWorkingDays: 'Escalate after', saBatchApprovalRequired: 'Super Admin approval of disbursement batches' },
    empl: { rehireKeepEmployeeNo: 'Keep same employee no. on rehire', maxTopOfOrg: 'Top of organisation' },
    ret: { retentionYearsHr: 'HR records', retentionYearsPayroll: 'Payroll records', retentionYearsAudit: 'Audit logs', retentionDaysImportFiles: 'Import source files' },
    ntf: { hrReplyToEmail: 'Reply-to HR mailbox', directoryShowBirthdays: 'Staff directory: show birthdays' },
  };

  const pad = Number(emp.value.employeeNoPadding) || 0;
  const sample = `${emp.value.employeeNoPrefix}${String(emp.value.employeeNoNext || '').padStart(pad, '0')}`;

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 3 }}>
        <Card sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
          <nav aria-label="Settings sections">
            <List dense sx={{ display: { xs: 'flex', md: 'block' }, overflowX: { xs: 'auto', md: 'visible' }, py: { xs: 0.5, md: 1 } }}>
              {SECTIONS.map((s) => (
                <ListItemButton key={s.id} component="a" href={`#${s.id}`} sx={{ flex: '0 0 auto', minHeight: 44 }}>
                  <ListItemText primary={s.label} slotProps={{ primary: { noWrap: true } }} />
                </ListItemButton>
              ))}
            </List>
          </nav>
        </Card>
        {settings.updatedAt && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1, px: 1 }}>
            Last updated by {settings.updatedByName ?? 'System'} at {formatDateTime(settings.updatedAt)}
          </Typography>
        )}
      </Grid>

      <Grid size={{ xs: 12, md: 9 }}>
        <Stack spacing={2}>
          <FormCard
            id="employee-numbers"
            title="Employee numbers"
            lockedReason={lock}
            onSave={() => save(emp, () => saveEmployeeNumberSettings(emp.value), LBL.emp)}
            saving={emp.runner.saving}
            dirty={emp.dirty}
            error={emp.runner.error}
            fieldErrors={emp.runner.fieldErrors}
            fieldLabels={LBL.emp}
          >
            <FormGrid>
              <TextInput label="Prefix" required value={emp.value.employeeNoPrefix} onChange={(v) => emp.set('employeeNoPrefix', v)} maxLength={10} error={emp.runner.fieldErrors.employeeNoPrefix} helper="e.g. INT-" locked={L} />
              <NumberInput label="Padding" required value={emp.value.employeeNoPadding} onChange={(v) => emp.set('employeeNoPadding', v)} min={1} max={8} error={emp.runner.fieldErrors.employeeNoPadding} helper="Digits after the prefix" locked={L} />
              <NumberInput label="Next number" required value={emp.value.employeeNoNext} onChange={(v) => emp.set('employeeNoNext', v)} min={1} error={emp.runner.fieldErrors.employeeNoNext} helper={`Next new hire: ${sample}`} locked={L} />
            </FormGrid>
          </FormCard>

          <FormCard
            id="probation-notice"
            title="Probation & notice"
            lockedReason={lock}
            onSave={() => save(prob, () => saveProbationNoticeSettings(prob.value), LBL.prob)}
            saving={prob.runner.saving}
            dirty={prob.dirty}
            error={prob.runner.error}
            fieldErrors={prob.runner.fieldErrors}
            fieldLabels={LBL.prob}
          >
            <FormGrid>
              <NumberInput label="Default probation" required value={prob.value.defaultProbationMonths} onChange={(v) => prob.set('defaultProbationMonths', v)} min={0} max={24} suffix="months" error={prob.runner.fieldErrors.defaultProbationMonths} locked={L} />
              <NumberInput label="Maximum total probation" required value={prob.value.maxProbationMonths} onChange={(v) => prob.set('maxProbationMonths', v)} min={1} max={24} suffix="months" error={prob.runner.fieldErrors.maxProbationMonths} locked={L} />
              <NumberInput label="Notice (< 2 years' service)" required value={prob.value.noticeWeeksLt2} onChange={(v) => prob.set('noticeWeeksLt2', v)} min={4} max={52} suffix="weeks" error={prob.runner.fieldErrors.noticeWeeksLt2} helper="EA s12 minimum 4" locked={L} />
              <NumberInput label="Notice (2 to < 5 years)" required value={prob.value.noticeWeeks2to5} onChange={(v) => prob.set('noticeWeeks2to5', v)} min={6} max={52} suffix="weeks" error={prob.runner.fieldErrors.noticeWeeks2to5} helper="EA s12 minimum 6" locked={L} />
              <NumberInput label="Notice (≥ 5 years)" required value={prob.value.noticeWeeksGe5} onChange={(v) => prob.set('noticeWeeksGe5', v)} min={8} max={52} suffix="weeks" error={prob.runner.fieldErrors.noticeWeeksGe5} helper="EA s12 minimum 8" locked={L} />
              <NumberInput label="Invite timing for new hires" required value={prob.value.inviteLeadDays} onChange={(v) => prob.set('inviteLeadDays', v)} min={0} max={30} suffix="days before join date" error={prob.runner.fieldErrors.inviteLeadDays} locked={L} />
            </FormGrid>
          </FormCard>

          <FormCard
            id="sign-in"
            title="Sign-in & security"
            lockedReason={lock}
            onSave={() => save(sec, () => saveSignInSecuritySettings(sec.value), LBL.sec)}
            saving={sec.runner.saving}
            dirty={sec.dirty}
            error={sec.runner.error}
            fieldErrors={sec.runner.fieldErrors}
            fieldLabels={LBL.sec}
          >
            <FormGrid>
              <FullRow>
                <ChipsInput label="Allowed login email domains" value={sec.value.allowedEmailDomains} onChange={(v) => sec.set('allowedEmailDomains', v)} error={sec.runner.fieldErrors.allowedEmailDomains} locked={L} helper={lock ? undefined : 'Type a domain (e.g. interact.com.my) and press Enter.'} />
              </FullRow>
              <NumberInput label="Session idle timeout (employees)" required value={sec.value.idleTimeoutMinEmployee} onChange={(v) => sec.set('idleTimeoutMinEmployee', v)} min={5} max={120} suffix="min" error={sec.runner.fieldErrors.idleTimeoutMinEmployee} locked={L} />
              <NumberInput label="Session idle timeout (Admin / Super Admin)" required value={sec.value.idleTimeoutMinPrivileged} onChange={(v) => sec.set('idleTimeoutMinPrivileged', v)} min={5} max={60} suffix="min" error={sec.runner.fieldErrors.idleTimeoutMinPrivileged} helper="New sessions use the new value" locked={L} />
              <NumberInput label="Lockout after failed attempts" required value={sec.value.lockoutThreshold} onChange={(v) => sec.set('lockoutThreshold', v)} min={3} max={10} suffix="attempts" error={sec.runner.fieldErrors.lockoutThreshold} locked={L} />
              <NumberInput label="Lockout duration" required value={sec.value.lockoutMinutes} onChange={(v) => sec.set('lockoutMinutes', v)} min={5} max={1440} suffix="min" error={sec.runner.fieldErrors.lockoutMinutes} locked={L} />
              <NumberInput label="Invitation link validity" required value={sec.value.inviteLinkHours} onChange={(v) => sec.set('inviteLinkHours', v)} min={1} max={168} suffix="hours" error={sec.runner.fieldErrors.inviteLinkHours} locked={L} />
              <SwitchInput label="MFA required for privileged roles" checked={sec.value.mfaRequiredPrivileged} onChange={(v) => sec.set('mfaRequiredPrivileged', v)} helper="Admin and Super Admin must use an authenticator app (Q31)" locked={L} />
            </FormGrid>
          </FormCard>

          <FormCard
            id="approvals"
            title="Approvals"
            lockedReason={lock}
            onSave={() => save(appr, () => saveApprovalSettings(appr.value), LBL.appr)}
            saving={appr.runner.saving}
            dirty={appr.dirty}
            error={appr.runner.error}
            fieldErrors={appr.runner.fieldErrors}
            fieldLabels={LBL.appr}
          >
            <FormGrid>
              <NumberInput label="Reminder after" required value={appr.value.reminderAfterWorkingDays} onChange={(v) => appr.set('reminderAfterWorkingDays', v)} min={1} max={30} suffix="working days" error={appr.runner.fieldErrors.reminderAfterWorkingDays} locked={L} />
              <NumberInput label="Escalate after" required value={appr.value.escalateAfterWorkingDays} onChange={(v) => appr.set('escalateAfterWorkingDays', v)} min={1} max={60} suffix="working days" error={appr.runner.fieldErrors.escalateAfterWorkingDays} locked={L} />
              <SwitchInput label="Super Admin approval of disbursement batches" checked={appr.value.saBatchApprovalRequired} onChange={(v) => appr.set('saBatchApprovalRequired', v)} helper="Optional control, default off (D12)" locked={L} />
              <KeyValue
                label="Cancellation approval at level 1 only"
                value={settings.cancellationApproverLevel1Only === null ? 'Set with the leave module' : settings.cancellationApproverLevel1Only ? 'Yes' : 'No'}
              />
            </FormGrid>
          </FormCard>

          <LinkCard id="leave" title="Leave" body="Leave policy settings (Admin and Super Admin edit)." href="/leave/setup/policy" label="Open leave settings" />
          <LinkCard id="claims" title="Claims" body="Claims settings (Admin and Super Admin edit; batch approval is the Super Admin setting above)." href="/claims/setup/settings" label="Open claims settings" />
          <Card id="payroll" component="section" aria-labelledby="payroll-h">
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography id="payroll-h" variant="h5" component="h2" sx={{ mb: 1 }}>
                Payroll (R1.1)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Payroll settings arrive with Release 1.1.
              </Typography>
            </CardContent>
          </Card>

          <FormCard
            id="rehire"
            title="Rehire"
            lockedReason={lock}
            onSave={() => save(empl, () => saveEmploymentSettings(empl.value), LBL.empl)}
            saving={empl.runner.saving}
            dirty={empl.dirty}
            error={empl.runner.error}
            fieldErrors={empl.runner.fieldErrors}
            fieldLabels={LBL.empl}
          >
            <FormGrid>
              <SwitchInput label="Keep same employee no. on rehire" checked={empl.value.rehireKeepEmployeeNo} onChange={(v) => empl.set('rehireKeepEmployeeNo', v)} helper="Default Yes" locked={L} />
              <NumberInput label="Top of organisation (max employees without a manager)" required value={empl.value.maxTopOfOrg} onChange={(v) => empl.set('maxTopOfOrg', v)} min={1} max={5} error={empl.runner.fieldErrors.maxTopOfOrg} locked={L} />
            </FormGrid>
          </FormCard>

          <FormCard
            id="retention"
            title="Retention"
            subtitle="Proposed defaults (§10.6, Q29 — verify with the legal adviser)."
            lockedReason={lock}
            onSave={() => save(ret, () => saveRetentionSettings(ret.value), LBL.ret)}
            saving={ret.runner.saving}
            dirty={ret.dirty}
            error={ret.runner.error}
            fieldErrors={ret.runner.fieldErrors}
            fieldLabels={LBL.ret}
          >
            <FormGrid>
              <NumberInput label="Employee master, job history, leave" required value={ret.value.retentionYearsHr} onChange={(v) => ret.set('retentionYearsHr', v)} min={7} max={20} suffix="years after separation" error={ret.runner.fieldErrors.retentionYearsHr} locked={L} />
              <NumberInput label="Payroll records" required value={ret.value.retentionYearsPayroll} onChange={(v) => ret.set('retentionYearsPayroll', v)} min={7} max={20} suffix="years" error={ret.runner.fieldErrors.retentionYearsPayroll} locked={L} />
              <NumberInput label="Audit and access logs" required value={ret.value.retentionYearsAudit} onChange={(v) => ret.set('retentionYearsAudit', v)} min={7} max={20} suffix="years" error={ret.runner.fieldErrors.retentionYearsAudit} locked={L} />
              <NumberInput label="Import source files" required value={ret.value.retentionDaysImportFiles} onChange={(v) => ret.set('retentionDaysImportFiles', v)} min={1} max={365} suffix="days after import" error={ret.runner.fieldErrors.retentionDaysImportFiles} locked={L} />
            </FormGrid>
          </FormCard>

          <FormCard
            id="notifications"
            title="Notifications"
            lockedReason={lock}
            onSave={() => save(ntf, () => saveNotificationSettings(ntf.value), LBL.ntf)}
            saving={ntf.runner.saving}
            dirty={ntf.dirty}
            error={ntf.runner.error}
            fieldErrors={ntf.runner.fieldErrors}
            fieldLabels={LBL.ntf}
          >
            <FormGrid>
              <TextInput label="Reply-to HR mailbox" type="email" value={ntf.value.hrReplyToEmail} onChange={(v) => ntf.set('hrReplyToEmail', v)} maxLength={254} error={ntf.runner.fieldErrors.hrReplyToEmail} locked={L} />
              <SwitchInput label="Staff directory: show birthdays" checked={ntf.value.directoryShowBirthdays} onChange={(v) => ntf.set('directoryShowBirthdays', v)} helper="Could; default off" locked={L} />
            </FormGrid>
          </FormCard>
          <Box sx={{ height: 24 }} />
        </Stack>
      </Grid>
    </Grid>
  );
}
