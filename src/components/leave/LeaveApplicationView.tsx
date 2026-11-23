'use client';

// P4 · Leave application detail (own) — S-PT-04 · /my/leave/{ref} · US-LEAVE-013, 016
// P27 · Leave decision view — S-AP-02 · /approvals/leave/{ref} (also from L1) · F-LV-09/10/13/24/26/29 ·
//       US-LEAVE-014, 016, 020, 031, 032, 034, 042
// One role-projected detail (getLeaveApplication): header (LA1 copyable, chips LA18/LA16/LA17/Attachment pending,
// type, dates + sessions, days, linked part) · Details · Attachments (MC viewing logged) · Balance · Team on
// leave (approver/ADM) · Maternity allowance (HR only) · MC verified (ADM/SA) · Approval trail (LA19) · History ·
// actions by role and state (server `task` / `cancellationTask` / `can`). Own item → "You can't decide your own leave."
// Concurrency: "Already decided by {name} at dd/mm/yyyy HH:mm" and the actions disappear.
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockIcon from '@mui/icons-material/Lock';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  LEAVE_SESSION_LABELS,
  LEAVE_STATUS_LABELS,
  MC_STATUSES,
  MC_STATUS_LABELS,
  type LeaveApplicationDetail,
  type McStatus,
} from '@/server/contracts/leave';
import { ACTING_AS_LABELS, type ApprovalTrailRow } from '@/server/contracts/approvals';
import { addLeaveAttachment, cancelLeaveOnBehalf, getLeaveAttachmentUrl, setMcStatus, withdrawLeaveOnBehalf } from '@/server/actions/leave';
import { KVGrid, MiniTable } from '../employees/ui';
import { SelectInput, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import RecordFooter from '../forms/RecordFooter';
import ReasonDialog from '../dialogs/ReasonDialog';
import { useToast } from '../ToastProvider';
import { formatDate, formatDateTime } from '@/lib/format';
import { DecisionDialog, type DecisionKind, type DecisionSubject } from '../approvals/DecisionDialog';
import { LeaveFlags, LeaveStatusChip, PanelRow, TaskStatusChip, TypeLabel, daysText, formatDays, openUrl } from './common';
import OwnLeaveDialogs, { type OwnLeaveTarget } from './OwnLeaveDialogs';
import { AttachmentPicker, formatBytes, uploadLeaveFile, type UploadedFile } from './upload';
import { stickyBarSx } from '../forms/stickyBar';

const card = { p: { xs: 2, sm: 3 } } as const;

export function CopyRef({ value }: { value: string }) {
  const toast = useToast();
  return (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography variant="h4" component="p" className="pret-tnum">
        {value}
      </Typography>
      <Tooltip title="Copy reference">
        <IconButton
          size="small"
          aria-label={`Copy ${value}`}
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            toast.success('Reference copied.');
          }}
        >
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

/** LA19 approval trail (+ greyed "Waiting for {name}" row). */
export function ApprovalTrail({ trail, waitingFor }: { trail: ApprovalTrailRow[]; waitingFor?: string | null }) {
  return (
    <>
      <MiniTable
        caption="Approval trail"
        rows={trail}
        getRowId={(t) => t.taskId}
        empty="No approval steps yet."
        columns={[
          { key: 'l', header: 'Level', render: (t) => `L${t.level} ${t.sourceLabel}` },
          { key: 'a', header: 'Approver', render: (t) => t.decidedByName ?? t.approverName },
          {
            key: 'as',
            header: 'Acting as',
            render: (t) => [t.actingAs ? ACTING_AS_LABELS[t.actingAs] : null, t.routingNote].filter(Boolean).join(' · ') || '—',
          },
          { key: 'd', header: 'Decision', render: (t) => <TaskStatusChip status={t.status} /> },
          { key: 'c', header: 'Comment', render: (t) => t.comment ?? '—' },
          { key: 'at', header: 'Date', render: (t) => (t.decidedAt ? formatDateTime(t.decidedAt) : formatDateTime(t.createdAt)) },
        ]}
      />
      {waitingFor && (
        <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
          Waiting for {waitingFor}
        </Typography>
      )}
    </>
  );
}

type Dlg =
  | { kind: 'decide'; decision: DecisionKind; subject: DecisionSubject; taskId: string; version: number }
  | { kind: 'withdrawOnBehalf' }
  | { kind: 'cancelOnBehalf' }
  | null;

export default function LeaveApplicationView({ app, mode, backHref }: { app: LeaveApplicationDetail; mode: 'own' | 'approver'; backHref?: string }) {
  const router = useRouter();
  const toast = useToast();
  const r = useActionRunner();
  const [own, setOwn] = React.useState<OwnLeaveTarget | null>(null);
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [mc, setMc] = React.useState<McStatus>(app.mcStatus ?? 'not_checked');
  const [mcRemarks, setMcRemarks] = React.useState('');
  const [newFiles, setNewFiles] = React.useState<UploadedFile[]>([]);
  const base = { applicationId: app.id, refNo: app.refNo, days: app.days };
  const t = app.task;
  const ct = app.cancellationTask;
  const decided = app.alreadyDecided;
  const medical = app.leaveType.category === 'sick' || app.leaveType.category === 'hospitalisation' || app.leaveType.category === 'maternity';

  // ---- actions -------------------------------------------------------------------------------
  const ownActions = mode === 'own' && (
    <>
      {app.can.withdraw && (
        <Button variant="outlined" color="error" onClick={() => setOwn({ kind: 'withdraw', ...base })}>
          Withdraw
        </Button>
      )}
      {app.can.cancel && (
        <Button variant="outlined" color="error" onClick={() => setOwn({ kind: 'cancel', ...base })}>
          Cancel leave
        </Button>
      )}
      {app.can.requestCancellation && (
        <Button variant="outlined" onClick={() => setOwn({ kind: 'request', ...base })}>
          Request cancellation
        </Button>
      )}
    </>
  );
  const decideBtns = mode === 'approver' && !decided && (
    <>
      {t?.canDecide && !t.overrideOnly && (
        <>
          <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'decide', decision: 'reject', subject: 'leave', taskId: t.taskId, version: t.version })}>
            Reject
          </Button>
          <Button variant="contained" onClick={() => setDlg({ kind: 'decide', decision: 'approve', subject: 'leave', taskId: t.taskId, version: t.version })}>
            Approve
          </Button>
        </>
      )}
      {t?.canDecide && t.overrideOnly && (
        <>
          <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'decide', decision: 'override_reject', subject: 'leave', taskId: t.taskId, version: t.version })}>
            Reject as Admin (override)
          </Button>
          <Button variant="contained" onClick={() => setDlg({ kind: 'decide', decision: 'override_approve', subject: 'leave', taskId: t.taskId, version: t.version })}>
            Approve as Admin (override)
          </Button>
        </>
      )}
      {ct?.canDecide && (
        <>
          <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'decide', decision: ct.overrideOnly ? 'override_reject' : 'reject', subject: 'cancellation', taskId: ct.taskId, version: ct.version })}>
            Reject cancellation
          </Button>
          <Button variant="contained" onClick={() => setDlg({ kind: 'decide', decision: ct.overrideOnly ? 'override_approve' : 'approve', subject: 'cancellation', taskId: ct.taskId, version: ct.version })}>
            Approve cancellation
          </Button>
        </>
      )}
    </>
  );
  const hrBtns = mode === 'approver' && (
    <>
      {app.can.withdrawOnBehalf && (
        <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'withdrawOnBehalf' })}>
          Withdraw on behalf
        </Button>
      )}
      {app.can.cancelOnBehalf && (
        <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'cancelOnBehalf' })}>
          Cancel on behalf
        </Button>
      )}
      {app.can.reassign && (
        <Button variant="text" component={NextLink} href="/leave/delegations#reassign">
          Reassign approver
        </Button>
      )}
    </>
  );
  const hasActions = Boolean(
    (mode === 'own' && (app.can.withdraw || app.can.cancel || app.can.requestCancellation)) ||
      (mode === 'approver' && (((t?.canDecide || ct?.canDecide) && !decided) || app.can.withdrawOnBehalf || app.can.cancelOnBehalf || app.can.reassign)),
  );

  const linkFor = (ref: string) => (mode === 'own' ? `/my/leave/${encodeURIComponent(ref)}` : `/approvals/leave/${encodeURIComponent(ref)}`);
  const sessions = `${formatDate(app.startDate)} (${LEAVE_SESSION_LABELS[app.startSession]}) – ${formatDate(app.endDate)} (${LEAVE_SESSION_LABELS[app.endSession]})`;

  return (
    <Stack spacing={2} sx={{ pb: hasActions ? { xs: 10, sm: 0 } : 0 }}>
      {decided && (
        <Alert severity="info">
          Already decided by {decided.byName} at {formatDateTime(decided.at)}.
        </Alert>
      )}
      {mode === 'approver' && app.isOwn && <Alert severity="info">You can&apos;t decide your own leave.</Alert>}
      {mode === 'approver' && !app.isOwn && !decided && t && !t.canDecide && t.blockedReason && <Alert severity="info">{t.blockedReason}</Alert>}
      {mode === 'approver' && t?.asDelegate && <Alert severity="info" variant="outlined">You are acting as a delegate for this item.</Alert>}

      {/* Header */}
      <Card>
        <CardContent sx={card}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <CopyRef value={app.refNo} />
            {app.status === 'pending' ? <LeaveStatusChip status="pending" level={app.level} /> : <LeaveStatusChip status={app.status} />}
            {app.status === 'pending' && app.levels > 1 && (
              <Typography variant="body2" color="text.secondary">
                (level {app.level} of {app.levels})
              </Typography>
            )}
            <LeaveFlags emergency={app.isEmergency} onBehalfName={app.onBehalfByName} attachmentPending={app.attachmentPending} mcInvalid={app.mcStatus === 'invalid'} />
          </Stack>
          {mode === 'approver' && (
            <Typography variant="body1" sx={{ mb: 0.5 }}>
              {app.employee.name} · {app.employee.employeeNo} · {app.employee.department} · {app.employee.position}
            </Typography>
          )}
          <Typography variant="body1" component="div" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <TypeLabel type={app.leaveType} /> · <span className="pret-tnum">{sessions}</span> · <strong>{daysText(app.days)}</strong>
          </Typography>
          {app.linked && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              Linked application: Part {app.linked.part} of 2:{' '}
              <Link component={NextLink} href={linkFor(app.linked.refNo)}>
                {app.linked.refNo} ›
              </Link>
            </Typography>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Applied {formatDateTime(app.submittedAt)}
            {app.decidedAt ? ` · Decided ${formatDateTime(app.decidedAt)}` : ''}
          </Typography>
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={2}>
            {/* Details */}
            <Card>
              <CardContent sx={card}>
                <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                  Details
                </Typography>
                <KVGrid
                  columns={2}
                  items={[
                    { label: 'Reason', value: app.reason, full: true },
                    { label: 'Expected confinement date', value: formatDate(app.expectedConfinementDate), hidden: !app.expectedConfinementDate },
                    { label: "Child's date of birth", value: formatDate(app.childBirthDate), hidden: !app.childBirthDate },
                    { label: 'Contact while on leave', value: app.contactPhone },
                    { label: 'Cover / handover', value: app.cover ? `${app.cover.name}${app.cover.employeeNo ? ` (${app.cover.employeeNo})` : ''}` : '' },
                    { label: 'Submitted at', value: formatDateTime(app.submittedAt) },
                    { label: 'Status', value: LEAVE_STATUS_LABELS[app.status] },
                    { label: 'On behalf by', value: app.onBehalfByName, hidden: !app.onBehalfByName },
                    { label: 'Reason for acting on behalf', value: app.onBehalfReason, hidden: !app.onBehalfReason, full: true },
                    { label: 'Cancellation requested', value: formatDateTime(app.cancellationRequestedAt), hidden: !app.cancellationRequestedAt },
                    { label: 'Cancelled at', value: formatDateTime(app.cancelledAt), hidden: !app.cancelledAt },
                    { label: 'Cancellation reason', value: app.cancelReason, hidden: !app.cancelReason, full: true },
                  ]}
                />
                {app.breakdown.length > 0 && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="caption" color="text.secondary">
                      How the days were counted
                    </Typography>
                    <Typography variant="body2" className="pret-tnum">
                      {app.breakdown.map((d) => `${formatDate(d.date)} ${d.label} ${formatDays(d.weight)}`).join(' · ')}
                    </Typography>
                  </Box>
                )}
              </CardContent>
            </Card>

            {/* Attachments (LA11) */}
            {(app.attachments !== null || app.can.addAttachment || app.attachmentPending) && (
              <Card>
                <CardContent sx={card}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                    <Typography variant="h5" component="h2">
                      Attachments
                    </Typography>
                    {app.attachmentsLogged && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        <LockIcon sx={{ fontSize: 14 }} /> {medical ? 'MC viewing is logged' : 'Viewing is logged'}
                      </Typography>
                    )}
                  </Stack>
                  {app.attachments === null ? (
                    <Typography color="text.secondary">Attachments are visible to the employee and HR only.</Typography>
                  ) : app.attachments.length === 0 ? (
                    <Typography color="text.secondary">{app.attachmentPending ? `Attachment pending${app.attachmentDueAt ? ` — due by ${formatDateTime(app.attachmentDueAt)}` : ''}.` : 'No attachments.'}</Typography>
                  ) : (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {app.attachments.map((f) => (
                        <Button
                          key={f.fileId}
                          variant="outlined"
                          startIcon={<AttachFileIcon />}
                          onClick={() => openUrl(() => getLeaveAttachmentUrl({ applicationId: app.id, fileId: f.fileId }), (m) => toast.info(m))}
                        >
                          {f.fileName} · {formatBytes(f.sizeBytes)}
                        </Button>
                      ))}
                    </Stack>
                  )}
                  {app.can.addAttachment && (
                    <Box sx={{ mt: 2 }}>
                      <AttachmentPicker label="Add attachment" max={3 - (app.attachments?.length ?? 0)} files={newFiles} onChange={setNewFiles} upload={(file) => uploadLeaveFile(file, app.leaveType.id)} />
                      {newFiles.length > 0 && (
                        <Button
                          sx={{ mt: 1 }}
                          variant="contained"
                          loading={r.saving}
                          onClick={async () => {
                            const res = await r.run(() => addLeaveAttachment({ applicationId: app.id, fileIds: newFiles.map((x) => x.fileId) }), { success: 'Attachment added.' });
                            if (res?.ok) setNewFiles([]);
                          }}
                        >
                          Save attachment
                        </Button>
                      )}
                      {r.error && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          {r.error}
                        </Alert>
                      )}
                    </Box>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Team on leave on these dates (P27, F-LV-29) */}
            {app.teamOnLeave && (
              <Card>
                <CardContent sx={card}>
                  <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
                    Team on leave on these dates
                  </Typography>
                  {app.teamAbsenceWarning && (
                    <Alert severity="warning" icon={<WarningAmberIcon />} sx={{ mb: 1 }}>
                      {app.teamAbsenceWarning}
                    </Alert>
                  )}
                  {app.teamOnLeave.length === 0 ? (
                    <Typography color="text.secondary">No one else in the team is on leave on these dates.</Typography>
                  ) : (
                    <Stack spacing={0.5}>
                      {app.teamOnLeave.map((o) => (
                        <Typography key={o.employee.id} variant="body2">
                          {o.employee.name} — {o.dates.map((d) => formatDate(d)).join(', ')} ({o.label}
                          {o.status !== 'approved' ? `, ${LEAVE_STATUS_LABELS[o.status].toLowerCase()}` : ''})
                        </Typography>
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Approval trail (LA19) */}
            <Card>
              <CardContent sx={card}>
                <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                  Approval trail
                </Typography>
                <ApprovalTrail trail={app.trail} waitingFor={app.waitingFor} />
              </CardContent>
            </Card>

            {app.events.length > 0 && (
              <Card>
                <CardContent sx={card}>
                  <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                    History
                  </Typography>
                  <MiniTable
                    caption="History"
                    rows={app.events}
                    getRowId={(e) => `${e.at}-${e.event}`}
                    columns={[
                      { key: 'at', header: 'At', render: (e) => formatDateTime(e.at) },
                      { key: 'e', header: 'Event', render: (e) => e.event },
                      { key: 'by', header: 'By', render: (e) => `${e.actorName}${e.actingAs ? ` (${e.actingAs})` : ''}` },
                      { key: 'c', header: 'Comment', render: (e) => e.comment ?? '—' },
                    ]}
                  />
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Stack spacing={2}>
            {/* Balance (P27 panel / P4 "Balance effect") */}
            <Card>
              <CardContent sx={card}>
                <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                  {mode === 'own' ? 'Balance effect' : `Balance (${app.leaveType.name}, ${app.leaveYear})`}
                </Typography>
                <PanelRow label="Available" value={formatDays(app.balance.available)} />
                <PanelRow label="This application" value={formatDays(app.balance.thisApplication)} />
                <PanelRow label="Other pending" value={formatDays(app.balance.otherPending)} />
                <PanelRow label="After approval" value={formatDays(app.balance.afterApproval)} strong tone={Number(app.balance.afterApproval) < 0 ? 'error' : undefined} />
                {app.balance.earnedToDate && <PanelRow label="Earned to date" value={formatDays(app.balance.earnedToDate)} tone="muted" />}
              </CardContent>
            </Card>

            {/* Maternity allowance eligibility (BR-LV-42) — HR only */}
            {app.maternityAllowanceEligible && (
              <Card>
                <CardContent sx={card}>
                  <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                    Maternity allowance eligibility
                  </Typography>
                  <Typography>{app.maternityAllowanceEligible === 'eligible' ? 'Eligible' : app.maternityAllowanceEligible === 'not_eligible' ? 'Not eligible' : 'Check'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    HR only · service in the 9 months before confinement and surviving children (BR-LV-42).
                  </Typography>
                </CardContent>
              </Card>
            )}

            {/* MC verified (LA20, F-LV-26) */}
            {app.mcStatus !== null && (
              <Card>
                <CardContent sx={card}>
                  <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                    MC verified
                  </Typography>
                  {app.can.setMcStatus ? (
                    <Stack spacing={1.5}>
                      <SelectInput label="MC check" value={mc} onChange={(v) => setMc(v as McStatus)} options={MC_STATUSES.map((s) => ({ value: s, label: MC_STATUS_LABELS[s] }))} />
                      {mc === 'invalid' && (
                        <TextInput label="Why is the MC invalid?" required value={mcRemarks} onChange={setMcRemarks} maxLength={500} multiline minRows={2} error={r.fieldErrors.remarks} helper="The employee is notified (N-14) to resubmit or convert." />
                      )}
                      <Button
                        variant="contained"
                        disabled={mc === (app.mcStatus ?? 'not_checked') && mc !== 'invalid'}
                        loading={r.saving}
                        onClick={() => r.run(() => setMcStatus({ applicationId: app.id, mcStatus: mc, remarks: mcRemarks || null }), { success: `MC marked ${MC_STATUS_LABELS[mc].toLowerCase()}.` })}
                      >
                        Save MC check
                      </Button>
                    </Stack>
                  ) : (
                    <Typography>{MC_STATUS_LABELS[app.mcStatus]}</Typography>
                  )}
                  {app.mcCheckedAt && (
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                      Checked by {app.mcCheckedByName ?? '—'} at {formatDateTime(app.mcCheckedAt)}
                    </Typography>
                  )}
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>
      </Grid>

      {mode === 'own' && <Typography variant="caption" color="text.secondary">To change some days, cancel and apply again.</Typography>}
      <RecordFooter meta={app} />

      {/* Actions — sticky on phone */}
      {hasActions && (
        <Box
          sx={stickyBarSx}
        >
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
            {backHref && (
              <Button variant="text" component={NextLink} href={backHref} sx={{ mr: 'auto' }}>
                Back
              </Button>
            )}
            {hrBtns}
            {ownActions}
            {decideBtns}
          </Stack>
        </Box>
      )}

      <OwnLeaveDialogs target={own} onClose={() => setOwn(null)} />
      {dlg?.kind === 'decide' && (
        <DecisionDialog
          open
          kind={dlg.decision}
          subject={dlg.subject}
          reference={app.refNo}
          taskId={dlg.taskId}
          taskVersion={dlg.version}
          onClose={() => setDlg(null)}
          onDone={() => backHref && router.push(backHref)}
        />
      )}
      <ReasonDialog
        open={dlg?.kind === 'withdrawOnBehalf' || dlg?.kind === 'cancelOnBehalf'}
        title={dlg?.kind === 'withdrawOnBehalf' ? `Withdraw ${app.refNo} on behalf?` : `Cancel ${app.refNo} on behalf?`}
        confirmLabel={dlg?.kind === 'withdrawOnBehalf' ? 'Withdraw on behalf' : 'Cancel on behalf'}
        intro={`${app.employee.name}${app.employee.employeeNo ? ` (${app.employee.employeeNo})` : ''} and their manager are emailed (setting). ${daysText(app.days)} will be released. Reason at least 10 characters.`}
        onClose={() => setDlg(null)}
        onConfirm={async (reason) => {
          if (reason.length < 10) {
            toast.info('Reason must be at least 10 characters.');
            return;
          }
          const fn = dlg?.kind === 'withdrawOnBehalf' ? withdrawLeaveOnBehalf : cancelLeaveOnBehalf;
          const res = await r.run(() => fn({ applicationId: app.id, reason }), { success: dlg?.kind === 'withdrawOnBehalf' ? `${app.refNo} withdrawn on behalf.` : `${app.refNo} cancelled on behalf.` });
          if (res?.ok) setDlg(null);
          else if (res) toast.info(res.error);
        }}
      />
    </Stack>
  );
}
