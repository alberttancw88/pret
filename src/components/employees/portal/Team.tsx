'use client';

// P31 · My team — S-AP-06 · /team · F-PRT-12 · US-PORTAL-012 (leave columns live since W2-004: TeamRow.leave).
// P32 · Team member (limited profile) — S-AP-07 · /team/{employeeNo} · F-EMP-03 (M) · US-EMP-004.
//   Only PRD "M" fields: A16 · A1 · A2 · A3 · A7 · B1 · B3 · B4 · C1–C5 · F1, F3–F6, F8–F13,
//   F15–F19, F24, F27 · G1, G2, G5 · Leave / Claims (team scope; claims without batch / bank data).
//   Never: MyKad, DOB, religion, race, OKU, family, statutory, bank, documents, notes, pay.
//   RECORD PROBATION RECOMMENDATION (On Probation only) → P33.
// P33 · Probation recommendation — S-AP-08 · dialog · Recommendation * (Confirm / Extend /
//   Do not confirm) · Suggested extension (months 1–9, if Extend; total ≤ 12) · Remarks * 0/1000.
import * as React from 'react';
import { TeamMemberClaimsView } from '../../claims/EmployeeClaims';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  GENDER_LABELS,
  PROBATION_RECOMMENDATION_LABELS,
  lengthOfServiceText,
  type MyTeamParams,
  type Ref,
  type TeamMemberProfile,
  type TeamRow,
} from '@/server/contracts/employees';
import { exportMyTeamCsv, recordProbationRecommendation } from '@/server/actions/employees';
import ListPage, { type ListColumn } from '../../list/ListPage';
import { KeywordField, MultiSelectFilter, SelectFilter } from '../../list/FilterFields';
import { downloadServerCsv, useServerList } from '../../list/useServerList';
import FormDialog from '../../forms/FormDialog';
import { NumberInput, RadioInput, TextInput } from '../../forms/fields';
import { useActionRunner } from '../../forms/useActionRunner';
import { useToast } from '../../ToastProvider';
import PageTitle from '../../shell/PageTitle';
import { KVGrid, MiniTable, ProfileTabs, SectionCard, useTabParam } from '../ui';
import { EmploymentStatusChip, dateOr, phone } from '../labels';
import { EmergencyTable } from '../profile/ContactTab';
import { EmploymentFacts, SeparationFacts } from '../profile/EmploymentTab';
import { TEAM_FILTERS } from '../filters';
import StatusChip from '../../StatusChip';
import { TeamMemberLeaveView } from '../../leave/EmployeeLeave';
import { formatDate } from '@/lib/format';

export function MyTeamList({ rows, total, params, departments }: { rows: TeamRow[]; total: number; params: MyTeamParams; departments: Ref[] }) {
  const list = useServerList({ filters: TEAM_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const toast = useToast();
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<TeamRow>[] = [
    {
      key: 'name',
      header: 'Employee',
      value: (x) => `${x.fullName} (${x.employeeNo})`,
      render: (x) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <Avatar src={x.photoUrl ?? undefined} alt="" sx={{ width: 28, height: 28, fontSize: 12 }}>
            {x.fullName.charAt(0)}
          </Avatar>
          <span>
            {x.preferredName ?? x.fullName} · {x.employeeNo}
          </span>
        </Stack>
      ),
    },
    { key: 'position', header: 'Position', value: (x) => x.position.label },
    { key: 'department', header: 'Department', value: (x) => x.department.label },
    { key: 'direct', header: 'Reports', sortable: false, value: (x) => (x.isDirect ? 'Direct' : 'Indirect') },
    { key: 'status', header: 'Status', kind: 'status', sortable: false, value: (x) => x.status, render: (x) => <EmploymentStatusChip status={x.status} /> },
    {
      key: 'today',
      header: 'Today',
      sortable: false,
      value: (x) => (x.leave?.today ? (x.leave.today === 'full' ? 'On leave' : `On leave ${x.leave.today.toUpperCase()}`) : ''),
      render: (x) =>
        x.leave?.today ? <StatusChip set="leave" value="Approved" label={x.leave.today === 'full' ? 'On leave' : `On leave ${x.leave.today.toUpperCase()}`} /> : '—',
    },
    {
      key: 'week',
      header: 'This week',
      sortable: false,
      priority: 'low',
      value: (x) => (x.leave?.thisWeek ?? []).map((w) => `${formatDate(w.date).slice(0, 5)}${w.session !== 'full' ? ` ${w.session.toUpperCase()}` : ''}`).join(', '),
    },
    { key: 'al', header: 'AL available', sortable: false, align: 'right', value: (x) => (x.leave?.alAvailable != null ? Number(x.leave.alAvailable).toFixed(1) : '') },
    { key: 'sl', header: 'SL available', sortable: false, align: 'right', priority: 'low', value: (x) => (x.leave?.slAvailable != null ? Number(x.leave.slAvailable).toFixed(1) : '') },
    { key: 'rl', header: 'RL available', sortable: false, align: 'right', priority: 'low', value: (x) => (x.leave?.rlAvailable != null ? Number(x.leave.rlAvailable).toFixed(1) : '') },
    { key: 'pending', header: 'Pending items', sortable: false, align: 'right', value: (x) => (x.leave ? x.leave.pendingItems : '') },
  ];
  const onLeaveToday = rows.filter((x) => x.leave?.today).length;
  const thisWeek = rows.filter((x) => (x.leave?.thisWeek.length ?? 0) > 0).length;
  return (
    <>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Team size {total} · On leave today {onLeaveToday} · This week {thisWeek}{total > rows.length ? ' (this page)' : ''}.
      </Typography>
      <ListPage<TeamRow>
        itemName={{ singular: 'team member', plural: 'team members' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches name and employee no." />,
          <MultiSelectFilter key="d" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={departments.map((x) => ({ value: x.id, label: x.label }))} />,
          <SelectFilter
            key="s"
            label="Reportees"
            value={d.scope}
            onChange={(v) => set('scope', v || 'all')}
            options={[
              { value: 'all', label: 'Direct and indirect' },
              { value: 'direct', label: 'Direct only' },
            ]}
          />,
        ]}
        {...list.listProps}
        onExport={async () => {
          try {
            const res = await exportMyTeamCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'my-team', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(x) => x.employeeId}
        getRowHref={(x) => `/team/${encodeURIComponent(x.employeeNo)}`}
        getRowRef={(x) => x.fullName}
        empty={{ title: 'No one reports to you.' }}
      />
    </>
  );
}

export function TeamMemberView({ m }: { m: TeamMemberProfile }) {
  const tabs = [
    { value: 'profile', label: 'Profile' },
    { value: 'leave', label: 'Leave' },
    { value: 'claims', label: 'Claims' },
  ];
  const [tab, setTab] = useTabParam(tabs, 'profile');
  const [rec, setRec] = React.useState(false);
  const e = m.employment;
  return (
    <Box>
      <PageTitle title={m.preferredName ?? m.fullName} breadcrumbs={[{ label: 'My Team', href: '/team' }, { label: m.employeeNo }]} />
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar src={m.photoUrl ?? undefined} alt="" sx={{ width: 64, height: 64 }}>
              {m.fullName.charAt(0)}
            </Avatar>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h4" component="p">
                  {m.fullName}
                </Typography>
                <EmploymentStatusChip status={e.status} />
              </Stack>
              <Typography color="text.secondary">
                {m.preferredName ? `${m.preferredName} · ` : ''}
                {m.employeeNo} · {e.position.label} · {e.department.label} · {m.isDirectReport ? 'Direct report' : 'Indirect report'}
              </Typography>
            </Box>
          </Stack>
          {m.canRecommendProbation && (
            <Button variant="contained" sx={{ mt: 2, width: { xs: '100%', sm: 'auto' }, minHeight: 44 }} onClick={() => setRec(true)}>
              Record probation recommendation
            </Button>
          )}
        </CardContent>
      </Card>
      <ProfileTabs tabs={tabs} value={tab} onChange={setTab} label="Team member sections" />
      {tab === 'profile' && (
        <Stack spacing={2}>
          <SectionCard title="Contact">
            <KVGrid
              items={[
                { label: 'Employee no.', value: m.employeeNo },
                { label: 'Full name', value: m.fullName },
                { label: 'Preferred name', value: m.preferredName },
                { label: 'Gender', value: GENDER_LABELS[m.gender] },
                { label: 'Work email', value: m.workEmail },
                { label: 'Mobile', value: phone(m.mobilePhone) },
                { label: 'Work phone', value: m.workPhone },
              ]}
            />
          </SectionCard>
          <SectionCard title="Emergency contacts">
            <EmergencyTable rows={m.emergencyContacts} limited />
          </SectionCard>
          <SectionCard title="Employment">
            <EmploymentFacts e={e} limited />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Length of service: {lengthOfServiceText(e.lengthOfService)}
            </Typography>
          </SectionCard>
          {m.separation && (
            <SectionCard title="Separation">
              <SeparationFacts s={m.separation} />
            </SectionCard>
          )}
          {m.myRecommendations.length > 0 && (
            <SectionCard title="My probation recommendations">
              <MiniTable
                caption="My recommendations"
                rows={m.myRecommendations}
                getRowId={(x) => x.id}
                columns={[
                  { key: 'd', header: 'Recorded', render: (x) => dateOr(x.recommendedAt) },
                  { key: 'r', header: 'Recommendation', render: (x) => `${PROBATION_RECOMMENDATION_LABELS[x.recommendation]}${x.suggestedExtensionMonths ? ` (${x.suggestedExtensionMonths} months)` : ''}` },
                  { key: 'm', header: 'Remarks', render: (x) => x.remarks ?? '—' },
                ]}
              />
            </SectionCard>
          )}
        </Stack>
      )}
      {tab === 'leave' && <TeamMemberLeaveView leave={m.leave} />}
      {tab === 'claims' && <TeamMemberClaimsView claims={m.claims} />}
      <RecommendationDialog open={rec} onClose={() => setRec(false)} m={m} />
    </Box>
  );
}

function RecommendationDialog({ open, onClose, m }: { open: boolean; onClose: () => void; m: TeamMemberProfile }) {
  const r = useActionRunner();
  const [rec, setRecVal] = React.useState('');
  const [months, setMonths] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  React.useEffect(() => {
    if (open) {
      r.reset();
      setRecVal('');
      setMonths('');
      setRemarks('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const end = m.employment.extendedProbationEndDate ?? m.employment.probationEndDate;
  const daysLeft = end ? Math.ceil((new Date(`${end}T00:00:00+08:00`).getTime() - Date.now()) / 86400000) : null;
  return (
    <FormDialog
      open={open}
      title="Probation recommendation"
      onClose={onClose}
      submitLabel="Submit recommendation"
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={rec !== '' || remarks !== ''}
      onSubmit={async () => {
        const fe: Record<string, string> = {};
        if (!rec) fe.recommendation = 'Select a recommendation.';
        if (rec === 'extend' && !months) fe.suggestedExtensionMonths = 'Enter the suggested extension (months).';
        if (!remarks.trim()) fe.remarks = 'Remarks are required.';
        if (Object.keys(fe).length) {
          r.setFieldErrors(fe);
          return;
        }
        const res = await r.run(
          () => recordProbationRecommendation({ employeeId: m.id, recommendation: rec as 'confirm', suggestedExtensionMonths: rec === 'extend' ? months : null, remarks }),
          { success: 'Recommendation recorded. HR will confirm or extend.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <Typography sx={{ mb: 2 }}>
        {m.fullName} — probation ends {dateOr(end)}
        {daysLeft !== null ? ` (${daysLeft >= 0 ? `${daysLeft} days left` : `${-daysLeft} days ago`})` : ''}.
      </Typography>
      <Stack spacing={2}>
        <RadioInput
          label="Recommendation"
          required
          value={rec}
          onChange={setRecVal}
          options={Object.entries(PROBATION_RECOMMENDATION_LABELS).map(([value, label]) => ({ value, label }))}
          error={r.fieldErrors.recommendation}
        />
        {rec === 'extend' && (
          <NumberInput label="Suggested extension (months)" required value={months} onChange={setMonths} min={1} max={9} error={r.fieldErrors.suggestedExtensionMonths} helper="Total probation may not exceed 12 months." />
        )}
        <TextInput label="Remarks" required value={remarks} onChange={setRemarks} maxLength={1000} multiline minRows={3} error={r.fieldErrors.remarks} />
      </Stack>
    </FormDialog>
  );
}
