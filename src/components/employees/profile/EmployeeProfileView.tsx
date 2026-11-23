'use client';

// E3 · Employee profile — S-EM-03 · /employees/{employeeNo} · F-EMP-03–28 · US-EMP-004–027.
// Header: photo · Full name (Preferred) · INT-004 · status ● · Completeness % (n missing ›) ·
// Position · Department · Manager · Location – State · Joined · length of service · Portal ●.
// [EDIT ▾] jumps to the tab whose card to edit; [ACTIONS ▾] shows only actions valid for the
// status and the viewer (server `can` flags). Tabs in the URL (?tab=) so Back keeps them.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import {
  MY_STATE_LABELS,
  PORTAL_ACCOUNT_STATE_LABELS,
  lengthOfServiceText,
  type ActivityParams,
  type ActivityRow,
  type ChangeRequestRow,
  type DocumentListParams,
  type EmployeeDocumentRow,
  type FieldChangeRow,
  type HrNote,
  type PortalAccountState,
  type SensitiveView,
} from '@/server/contracts/employees';
import StatusChip from '../../StatusChip';
import PageTitle from '../../shell/PageTitle';
import { ProfileTabs, TabPlaceholder, useTabParam, type TabDef } from '../ui';
import type { EmployeeLeaveTab } from '@/server/contracts/leave';
import { EmployeeLeaveTabView } from '../../leave/EmployeeLeave';
import type { EmployeeClaimsTab } from '@/server/contracts/claims';
import { EmployeeClaimsTabView } from '../../claims/EmployeeClaims';
import type { SetupType } from '../../leave/AdjustOverride';
import { CompletenessBadge, EmploymentStatusChip, dateOr } from '../labels';
import type { ProfileCtx } from './context';
import { revealer } from './context';
import PersonalTab from './PersonalTab';
import ContactTab from './ContactTab';
import FamilyTab from './FamilyTab';
import EmploymentTab from './EmploymentTab';
import StatutoryTab from './StatutoryTab';
import BankTab from './BankTab';
import DocumentsTab from './DocumentsTab';
import { ActivityTab, ChangeRequestsTab, NotesTab, OverviewTab } from './OtherTabs';
import { ConfirmDialog, ExtendProbationDialog, HrNoteDialog, InviteDialog, PhotoDialog, WithdrawOfferDialog, WithdrawResignationDialog } from './dialogs';

export type ProfileTabData = {
  sensitive: SensitiveView | null;
  documents: { rows: EmployeeDocumentRow[]; total: number; params: DocumentListParams } | null;
  notes: HrNote[] | null;
  activity: { view: 'events' | 'fields'; rows: (ActivityRow | FieldChangeRow)[]; total: number; params: ActivityParams } | null;
  changeRequests: { rows: ChangeRequestRow[]; total: number } | null;
  /** W2-004 Leave tab (loaded only when the tab is open) */
  leave?: { tab: EmployeeLeaveTab | null; types: SetupType[]; currentYear: number } | null;
  /** W2-005 Claims tab (loaded only when the tab is open) */
  claims?: { tab: EmployeeClaimsTab | null; currentYear: number } | null;
};

const PORTAL_CHIP: Partial<Record<PortalAccountState, 'Invited' | 'Active' | 'Disabled'>> = {
  pending_activation: 'Invited',
  active: 'Active',
  disabled: 'Disabled',
};

export default function EmployeeProfileView({ ctx, data }: { ctx: ProfileCtx; data: ProfileTabData }) {
  const { profile } = ctx;
  const p = profile.personal;
  const e = profile.employment;
  const can = profile.can;
  const router = useRouter();
  const pathname = usePathname();

  const tabs: TabDef[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'personal', label: 'Personal' },
    { value: 'contact', label: 'Contact & emergency' },
    { value: 'family', label: 'Family' },
    { value: 'employment', label: 'Employment & history' },
    { value: 'statutory', label: 'Statutory & payroll' },
    { value: 'compensation', label: 'Compensation', hint: 'Release 1.1' },
    { value: 'payslips', label: 'Payslips', hint: 'Release 1.1' },
    { value: 'bank', label: 'Bank' },
    { value: 'leave', label: 'Leave', count: profile.openItems.pendingLeave + profile.openItems.pendingCredits || null },
    { value: 'claims', label: 'Claims', count: profile.openItems.pendingClaims || null },
    { value: 'documents', label: 'Documents' },
    { value: 'change_requests', label: 'Change requests', count: profile.openItems.changeRequests || null },
    { value: 'notes', label: 'Notes' },
    ...(can.viewActivity ? [{ value: 'activity', label: 'Activity log' }] : []),
  ];
  const [tab, setTab] = useTabParam(tabs, 'overview');
  const tabHref = (t: string) => `${pathname}?tab=${t}`;

  const [actionsEl, setActionsEl] = React.useState<HTMLElement | null>(null);
  const [editEl, setEditEl] = React.useState<HTMLElement | null>(null);
  const [dlg, setDlg] = React.useState<'invite' | 'confirm' | 'extend' | 'withdraw' | 'offer' | 'note' | 'photo' | null>(null);
  const no = encodeURIComponent(p.employeeNo);
  const revealFamily = (field: 'spouse_nric' | 'child_nric', rowId: string) => revealer(profile.id, field, rowId);
  const religionKnownNotIslam = Boolean(data.sensitive?.religion && data.sensitive.religion !== 'islam');

  type Act = { label: string; onClick?: () => void; href?: string; disabled?: string; show: boolean };
  const actions: Act[] = [
    { label: profile.portal.state === 'pending_activation' ? 'Re-send invite' : 'Send invite', onClick: () => setDlg('invite'), show: can.invite || can.resendInvite },
    { label: 'Confirm', onClick: () => setDlg('confirm'), show: can.confirm },
    { label: 'Extend probation', onClick: () => setDlg('extend'), show: can.extendProbation },
    { label: 'Record separation', href: `/employees/${no}/separation`, show: can.recordSeparation },
    { label: 'Edit separation', href: `/employees/${no}/separation`, show: can.editSeparation },
    { label: 'Withdraw resignation', onClick: () => setDlg('withdraw'), show: can.withdrawResignation },
    { label: 'Withdraw offer', onClick: () => setDlg('offer'), show: can.withdrawOffer },
    { label: 'Rehire', href: `/employees/${no}/rehire`, show: can.rehire },
    { label: 'Apply leave on behalf', href: `/leave/apply-on-behalf?employee=${encodeURIComponent(profile.id)}`, show: !profile.isOwnRecord },
    { label: 'Submit claim on behalf', href: `/claims/new-on-behalf?employee=${encodeURIComponent(profile.id)}`, show: !profile.isOwnRecord },
    { label: 'Adjust leave balance', href: `${pathname}?tab=leave&action=adjust`, show: !profile.isOwnRecord },
    { label: 'Add HR note', onClick: () => setDlg('note'), show: can.addNote },
  ];
  const editTargets: { label: string; tab: string; show: boolean }[] = [
    { label: 'Personal details', tab: 'personal', show: can.editPersonal },
    { label: 'Contact & emergency', tab: 'contact', show: can.editContact },
    { label: 'Family', tab: 'family', show: can.editFamily && !profile.isOwnRecord },
    { label: 'Employment', tab: 'employment', show: can.editEmployment },
    { label: 'Statutory & payroll', tab: 'statutory', show: can.editStatutory && !profile.isOwnRecord },
    { label: 'Bank details', tab: 'bank', show: can.editBank && !profile.isOwnRecord },
    { label: 'Documents', tab: 'documents', show: can.uploadDocument },
  ];
  const portalChip = PORTAL_CHIP[profile.portal.state];

  const body = (() => {
    switch (tab) {
      case 'personal':
        return <PersonalTab ctx={ctx} sensitive={data.sensitive} />;
      case 'contact':
        return <ContactTab employeeId={profile.id} contact={profile.contact} emergency={profile.emergencyContacts} canEdit={can.editContact} hasPortalAccount={profile.portal.userId !== null} />;
      case 'family':
        return <FamilyTab employeeId={profile.id} family={profile.family} canEdit={can.editFamily} own={profile.isOwnRecord} revealMode={can.reveal ? ctx.revealMode : 'none'} reveal={revealFamily} />;
      case 'employment':
        return <EmploymentTab ctx={ctx} documents={data.documents?.rows ?? []} maxProbationMonths={ctx.formOptions.settings.maxProbationMonths} />;
      case 'statutory':
        return <StatutoryTab ctx={ctx} religionKnownNotIslam={religionKnownNotIslam} />;
      case 'compensation':
        return <TabPlaceholder title="Compensation arrives with payroll" body={profile.placeholders.compensation || 'Basic salary and recurring pay items are captured from Release 1.1 (payroll).'} />;
      case 'payslips':
        return <TabPlaceholder title="Payslips arrive with payroll" body={profile.placeholders.payslips || 'Payslips are available from Release 1.1 (payroll).'} />;
      case 'bank':
        return <BankTab profile={profile} banks={ctx.formOptions.banks} revealMode={ctx.revealMode} />;
      case 'leave':
        return data.leave ? (
          <EmployeeLeaveTabView tab={data.leave.tab} types={data.leave.types} currentYear={data.leave.currentYear} isSuperAdmin={ctx.isSuperAdmin} isOwnRecord={profile.isOwnRecord} />
        ) : null;
      case 'claims':
        return data.claims ? <EmployeeClaimsTabView tab={data.claims.tab} employeeId={profile.id} currentYear={data.claims.currentYear} /> : null;
      case 'documents':
        return data.documents ? (
          <DocumentsTab employeeId={profile.id} rows={data.documents.rows} total={data.documents.total} params={data.documents.params} canUpload={can.uploadDocument} own={profile.isOwnRecord} />
        ) : null;
      case 'change_requests':
        return <ChangeRequestsTab rows={data.changeRequests?.rows ?? []} total={data.changeRequests?.total ?? 0} />;
      case 'notes':
        return <NotesTab employeeId={profile.id} notes={data.notes ?? []} canAdd={can.addNote} />;
      case 'activity':
        return data.activity ? <ActivityTab view={data.activity.view} rows={data.activity.rows} total={data.activity.total} params={data.activity.params} canExport={can.exportActivity} /> : null;
      default:
        return <OverviewTab profile={profile} tabHref={tabHref} />;
    }
  })();

  return (
    <Box>
      <PageTitle title={`${p.fullName} · ${p.employeeNo}`} breadcrumbs={[{ label: 'Employees', href: '/employees' }, { label: p.employeeNo }]} />
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Avatar src={p.photoUrl ?? undefined} alt="" sx={{ width: 72, height: 72, fontSize: 28 }}>
              {p.fullName.charAt(0)}
            </Avatar>
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="h4" component="p">
                  {p.fullName}
                  {p.preferredName ? ` (${p.preferredName})` : ''} · {p.employeeNo}
                </Typography>
                <EmploymentStatusChip status={e.status} />
                <Link component={NextLink} href={tabHref('overview')} underline="hover" scroll={false} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                  <CompletenessBadge c={profile.completeness} />
                  {profile.completeness.missing.length > 0 && <Typography variant="body2">({profile.completeness.missing.length} missing ›)</Typography>}
                </Link>
              </Stack>
              <Typography color="text.secondary">
                {e.position.label} · {e.department.label} · Manager: {e.manager?.name ?? (profile.employmentHr.isTopOfOrg ? 'Top of organisation' : '—')} · {e.workLocation.label} – {MY_STATE_LABELS[e.workState]}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography color="text.secondary">
                  Joined {dateOr(e.joinDate)} · {lengthOfServiceText(e.lengthOfService)} · Portal:
                </Typography>
                {portalChip ? <StatusChip set="user" value={portalChip} /> : <Typography color="text.secondary">{PORTAL_ACCOUNT_STATE_LABELS[profile.portal.state]}</Typography>}
                {profile.portal.inviteScheduledFor && (
                  <Typography variant="body2" color="text.secondary">
                    (invite scheduled {dateOr(profile.portal.inviteScheduledFor)})
                  </Typography>
                )}
              </Stack>
            </Box>
            <Stack direction="row" spacing={1}>
              {(editTargets.some((t) => t.show) || can.editPhoto) && (
                <Button variant="outlined" endIcon={<ArrowDropDownIcon />} onClick={(ev) => setEditEl(ev.currentTarget)} aria-haspopup="menu">
                  Edit
                </Button>
              )}
              <Button variant="contained" endIcon={<ArrowDropDownIcon />} onClick={(ev) => setActionsEl(ev.currentTarget)} aria-haspopup="menu">
                Actions
              </Button>
            </Stack>
          </Stack>
          {profile.isOwnRecord && (
            <Typography variant="body2" sx={{ mt: 1.5, color: 'warning.main' }}>
              This is your own record. Legal name, MyKad, family, religion/OKU, statutory and bank details are locked — use a change request (approved by another Admin or Super Admin).
            </Typography>
          )}
        </CardContent>
      </Card>

      <Menu anchorEl={editEl} open={Boolean(editEl)} onClose={() => setEditEl(null)}>
        {editTargets
          .filter((t) => t.show)
          .map((t) => (
            <MenuItem
              key={t.tab}
              onClick={() => {
                setEditEl(null);
                setTab(t.tab);
              }}
            >
              {t.label}
            </MenuItem>
          ))}
        <Divider />
        <MenuItem
          disabled={!can.editPhoto}
          onClick={() => {
            setEditEl(null);
            setDlg('photo');
          }}
        >
          Change photo
        </MenuItem>
      </Menu>
      <Menu anchorEl={actionsEl} open={Boolean(actionsEl)} onClose={() => setActionsEl(null)}>
        {actions
          .filter((a) => a.show)
          .map((a) => (
            <MenuItem
              key={a.label}
              disabled={Boolean(a.disabled)}
              onClick={() => {
                setActionsEl(null);
                if (a.href) router.push(a.href);
                else a.onClick?.();
              }}
            >
              <ListItemText primary={a.label} secondary={a.disabled} />
            </MenuItem>
          ))}
      </Menu>

      <ProfileTabs tabs={tabs} value={tab} onChange={setTab} label="Employee profile sections" />
      {body}

      <InviteDialog open={dlg === 'invite'} onClose={() => setDlg(null)} profile={profile} />
      <ConfirmDialog open={dlg === 'confirm'} onClose={() => setDlg(null)} profile={profile} />
      <ExtendProbationDialog open={dlg === 'extend'} onClose={() => setDlg(null)} profile={profile} maxMonths={ctx.formOptions.settings.maxProbationMonths} />
      <WithdrawResignationDialog open={dlg === 'withdraw'} onClose={() => setDlg(null)} profile={profile} />
      <WithdrawOfferDialog open={dlg === 'offer'} onClose={() => setDlg(null)} profile={profile} />
      <HrNoteDialog open={dlg === 'note'} onClose={() => setDlg(null)} employeeId={profile.id} note={null} />
      <PhotoDialog open={dlg === 'photo'} onClose={() => setDlg(null)} employeeId={profile.id} hasPhoto={Boolean(p.photoFileId)} />
    </Box>
  );
}
