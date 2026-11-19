'use client';

// E9 · Rehire — S-EM-09 · /employees/{no}/rehire · F-EMP-13 (Could) · US-EMP-026.
// Step 1 confirm person (identity of the separated record, read-only; "Same person" — BR-EMP-05) ·
// Step 2 employee no. (•) Keep (default per setting) (•) New number (SA types it; else assigned) +
// continuous-service date (•) New join date (•) Original join date (•) Other date ·
// Step 3 employment fields as S-EM-02 step 3 (new join date *) · Step 4 review & invite.
// Prior history stays (read-only in Job history).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import {
  EMPLOYMENT_STATUS_LABELS,
  GENDER_LABELS,
  SEPARATION_TYPE_LABELS,
  type EmployeeFormOptions,
  type EmployeeProfile,
} from '@/server/contracts/employees';
import type { OrgOptions } from '@/server/contracts/org';
import { rehireEmployee } from '@/server/actions/employees';
import ErrorSummary from '../forms/ErrorSummary';
import { CheckboxInput, DateInput, RadioInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import { EmploymentFields, emptyEmployment, type EmploymentForm } from './fieldGroups';
import { KVGrid } from './ui';
import { dateOr } from './labels';
import { addDays, formatDate, todayMyt } from '@/lib/format';

const STEPS = ['Confirm person', 'Employee no. & service', 'Employment', 'Review & invite'];

export default function RehireWizard({ profile, org, formOptions, isSuperAdmin }: { profile: EmployeeProfile; org: OrgOptions; formOptions: EmployeeFormOptions; isSuperAdmin: boolean }) {
  const router = useRouter();
  const r = useActionRunner();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const s = formOptions.settings;
  const p = profile.personal;
  const e = profile.employment;
  const [step, setStep] = React.useState(0);
  const [same, setSame] = React.useState(false);
  const [keepNo, setKeepNo] = React.useState(s.rehireKeepEmployeeNo ? 'keep' : 'new');
  const [newNo, setNewNo] = React.useState('');
  const [csChoice, setCsChoice] = React.useState<'new_join_date' | 'original_join_date' | 'other'>('new_join_date');
  const [csDate, setCsDate] = React.useState('');
  const [emp, setEmp] = React.useState<EmploymentForm>(() => ({
    ...emptyEmployment(s.defaultProbationMonths),
    departmentId: e.department.id,
    positionId: e.position.id,
    gradeId: e.grade.id,
    workLocationId: e.workLocation.id,
    workingPatternId: e.workingPattern.id,
  }));
  const [inviteMode, setInviteMode] = React.useState<'now' | 'scheduled' | 'later'>('scheduled');
  const [inviteDate, setInviteDate] = React.useState('');
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const today = todayMyt();
  const defInvite = emp.joinDate ? (addDays(emp.joinDate, -s.inviteLeadDays) < today ? today : addDays(emp.joinDate, -s.inviteLeadDays)) : '';
  const errors = { ...r.fieldErrors, ...local };

  const validate = (k: number): Record<string, string> => {
    const x: Record<string, string> = {};
    if (k === 0 && !same) x.samePersonConfirmed = 'Confirm this is the same person.';
    if (k === 1 && csChoice === 'other' && !csDate) x.continuousServiceDate = 'Enter the continuous-service date.';
    if (k === 2) {
      if (!emp.joinDate) x.joinDate = 'Enter the new join date.';
      if (!emp.departmentId) x.departmentId = 'Select the department.';
      if (!emp.positionId) x.positionId = 'Select the position.';
      if (!emp.gradeId) x.gradeId = 'Select the grade.';
      if (!emp.manager) x.managerId = 'Select the reporting manager.';
      if (!emp.workLocationId) x.workLocationId = 'Select the work location.';
      if (!emp.workingPatternId) x.workingPatternId = 'Select the working-week pattern.';
    }
    return x;
  };
  const next = () => {
    const x = validate(step);
    setLocal(x);
    if (!Object.keys(x).length) setStep(step + 1);
  };
  const submit = async () => {
    const res = await r.run(
      () =>
        rehireEmployee({
          employeeId: profile.id,
          samePersonConfirmed: true,
          keepEmployeeNo: keepNo === 'keep',
          newEmployeeNo: keepNo === 'new' && isSuperAdmin ? newNo : null,
          joinDate: emp.joinDate,
          continuousServiceChoice: csChoice,
          continuousServiceDate: csChoice === 'other' ? csDate : null,
          probationMonths: emp.probationMonths,
          departmentId: emp.departmentId,
          positionId: emp.positionId,
          gradeId: emp.gradeId,
          managerId: emp.manager?.id ?? null,
          workLocationId: emp.workLocationId,
          workingPatternId: emp.workingPatternId,
          invite: { mode: inviteMode, scheduledSendDate: inviteMode === 'scheduled' ? inviteDate || defInvite : null },
        }),
      { refresh: false, success: (x) => `Rehired as ${(x as unknown as { employeeNo: string }).employeeNo}.` },
    );
    if (res?.ok) router.push(`/employees/${encodeURIComponent((res as unknown as { employeeNo: string }).employeeNo)}`);
  };

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          {phone ? (
            <Typography variant="subtitle1">
              Step {step + 1} of {STEPS.length}: {STEPS[step]}
            </Typography>
          ) : (
            <Stepper activeStep={step} alternativeLabel>
              {STEPS.map((l) => (
                <Step key={l}>
                  <StepLabel>{l}</StepLabel>
                </Step>
              ))}
            </Stepper>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <ErrorSummary error={r.error} fieldErrors={errors} />
          {step === 0 && (
            <Stack spacing={2}>
              <KVGrid
                items={[
                  { label: 'Employee no.', value: p.employeeNo },
                  { label: 'Full name', value: p.fullName },
                  { label: 'MyKad', value: p.nricMasked },
                  { label: 'Date of birth', value: dateOr(p.dateOfBirth) },
                  { label: 'Gender', value: GENDER_LABELS[p.gender] },
                  { label: 'Status', value: EMPLOYMENT_STATUS_LABELS[e.status] },
                  { label: 'Previous join date', value: dateOr(e.joinDate) },
                  { label: 'Separation', value: profile.separation ? `${SEPARATION_TYPE_LABELS[profile.separation.separationType]} · LWD ${dateOr(profile.separation.lastWorkingDay)}` : '' },
                  { label: 'Eligible for rehire', value: profile.separation?.details?.eligibleForRehire === false ? 'No' : profile.separation?.details?.eligibleForRehire ? 'Yes' : '—' },
                ]}
              />
              {profile.separation?.details?.eligibleForRehire === false && <Alert severity="warning">The separation record says this person is not eligible for rehire.</Alert>}
              <CheckboxInput label="This is the same person (identity data is reused)" checked={same} onChange={setSame} error={errors.samePersonConfirmed} />
            </Stack>
          )}
          {step === 1 && (
            <Stack spacing={3}>
              <RadioInput
                label="Employee no."
                value={keepNo}
                onChange={setKeepNo}
                options={[
                  { value: 'keep', label: `Keep ${p.employeeNo}${s.rehireKeepEmployeeNo ? ' (default)' : ''}` },
                  { value: 'new', label: isSuperAdmin ? 'New number' : `New number (assigned on save: ${s.employeeNoPreview})` },
                ]}
              />
              {keepNo === 'new' && isSuperAdmin && (
                <Box sx={{ maxWidth: 320 }}>
                  <TextInput label="New employee no." value={newNo} onChange={(v) => setNewNo(v.toUpperCase())} maxLength={20} helper={`Leave blank to assign ${s.employeeNoPreview}.`} error={errors.newEmployeeNo} />
                </Box>
              )}
              <RadioInput
                label="Continuous-service date"
                required
                value={csChoice}
                onChange={(v) => setCsChoice(v as typeof csChoice)}
                options={[
                  { value: 'new_join_date', label: 'New join date' },
                  { value: 'original_join_date', label: `Original join date (${dateOr(e.joinDate)})` },
                  { value: 'other', label: 'Other date' },
                ]}
              />
              {csChoice === 'other' && (
                <Box sx={{ maxWidth: 320 }}>
                  <DateInput label="Continuous-service date" required value={csDate} onChange={setCsDate} error={errors.continuousServiceDate} />
                </Box>
              )}
            </Stack>
          )}
          {step === 2 && (
            <EmploymentFields value={emp} onChange={(x) => setEmp((v) => ({ ...v, ...x }))} errors={errors} opts={{ org, maxProbationMonths: s.maxProbationMonths }} isSuperAdmin={isSuperAdmin} include="core" />
          )}
          {step === 3 && (
            <Stack spacing={2}>
              <KVGrid
                items={[
                  { label: 'Employee no.', value: keepNo === 'keep' ? p.employeeNo : newNo || `Assigned on save: ${s.employeeNoPreview}` },
                  { label: 'New join date', value: formatDate(emp.joinDate) },
                  { label: 'Continuous-service date', value: csChoice === 'new_join_date' ? formatDate(emp.joinDate) : csChoice === 'original_join_date' ? formatDate(e.joinDate) : formatDate(csDate) },
                  { label: 'Probation', value: `${emp.probationMonths} months` },
                  { label: 'Department', value: org.departments.find((x) => x.id === emp.departmentId)?.label ?? '' },
                  { label: 'Position', value: org.positions.find((x) => x.id === emp.positionId)?.label ?? '' },
                  { label: 'Grade', value: org.grades.find((x) => x.id === emp.gradeId)?.label ?? '' },
                  { label: 'Reporting manager', value: emp.manager?.name ?? '' },
                  { label: 'Work location', value: org.locations.find((x) => x.id === emp.workLocationId)?.label ?? '' },
                ]}
              />
              <RadioInput
                label="Portal invite"
                value={inviteMode}
                onChange={(v) => setInviteMode(v as typeof inviteMode)}
                options={[
                  { value: 'now', label: 'Send invite now' },
                  { value: 'scheduled', label: `Send on a date (default: join date − ${s.inviteLeadDays} days)` },
                  { value: 'later', label: "Don't schedule — I'll invite later" },
                ]}
              />
              {inviteMode === 'scheduled' && (
                <Box sx={{ maxWidth: 320 }}>
                  <DateInput label="Send on" required value={inviteDate || defInvite} onChange={setInviteDate} minDate={today} />
                </Box>
              )}
              <Alert severity="info" variant="outlined">
                The earlier employment, its job history and separation stay on the record (read-only).
              </Alert>
            </Stack>
          )}
        </CardContent>
      </Card>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
        <Button variant="outlined" color="inherit" onClick={() => router.push(`/employees/${encodeURIComponent(p.employeeNo)}`)} disabled={r.saving}>
          Cancel
        </Button>
        {step > 0 && (
          <Button variant="outlined" onClick={() => setStep(step - 1)} disabled={r.saving}>
            Back
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          <Button variant="contained" onClick={next}>
            Next
          </Button>
        ) : (
          <Button variant="contained" onClick={submit} loading={r.saving}>
            Rehire
          </Button>
        )}
      </Stack>
    </Box>
  );
}
