'use client';

// P15 · Claim detail (own) — S-PT-15 · /my/claims/{no} · F-CLM-08/13/29 · US-CLAIM-011, 016, 029
// P29 · Claim decision view — S-AP-04 · /approvals/claims/{no} (also from C1) · F-CLM-09/23/30 · US-CLAIM-012, 022, 028, 030
// One role-projected detail (getClaim): header CH1–CH16 (copyable claim no., status, flags, title, project, totals,
// copied from, on behalf) · employee line + submitted/waiting (approver) · lines with every CLN field the role may see
// (phone: cards), receipts → full-screen viewer (zoom, rotate, ‹ ›; "Viewing is logged" for non-owners), limit result,
// duplicate warnings, tax/GL (ADM/SA after approval) · utilisation for the claim's categories (P29) · status timeline ·
// approval trail · record footer. Actions by status and role from the server (`task`, `can`):
//   own: EDIT / SUBMIT / DELETE (New) · WITHDRAW (Submitted) · COPY TO NEW CLAIM (Rejected)
//   approver: APPROVE CLAIM / REJECT CLAIM (P30, reason ≥ 5) · CANCEL CLAIM (Approved, reason) · UNDO DISBURSEMENT (S-CL-14)
//   "You can't decide your own claim." · "Already decided by {name} at dd/mm/yyyy HH:mm" (buttons removed).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { TAX_TREATMENT_LABELS, DISBURSED_VIA_LABELS, type ClaimDetail, type ClaimLineView } from '@/server/contracts/claims';
import { cancelClaim, undoDisbursement } from '@/server/actions/claims';
import { MiniTable } from '../employees/ui';
import RecordFooter from '../forms/RecordFooter';
import ReasonDialog from '../dialogs/ReasonDialog';
import MoneyText from '../MoneyText';
import { useToast } from '../ToastProvider';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { DecisionDialog } from '../approvals/DecisionDialog';
import { ApprovalTrail, CopyRef } from '../leave/LeaveApplicationView';
import { PanelRow } from '../leave/common';
import { ClaimFlags, ClaimStatusChip, LimitChip, MoneyCell, ReceiptButtons, ReceiptViewer, UtilisationPanel, utilisationColumns, type ViewerFile } from './common';
import OwnClaimDialogs, { type OwnClaimTarget } from './OwnClaimDialogs';
import { AttachmentBundleDialog } from './AdminDialogs';

const card = { p: { xs: 2, sm: 3 } } as const;

function lineInfo(l: ClaimLineView): string {
  return [
    l.description,
    l.merchant ? `Merchant: ${l.merchant}` : null,
    l.fromPlace || l.toPlace ? `${l.fromPlace ?? ''} → ${l.toPlace ?? ''}` : null,
    l.purpose ? `Purpose: ${l.purpose}` : null,
    l.clientAttendees ? `Client / attendees: ${l.clientAttendees}` : null,
    l.travelDestination ? `Destination: ${l.travelDestination}` : null,
    l.claimantLabel && l.claimantLabel !== 'Self' ? `Claimant: ${l.claimantLabel}${l.dependantName ? ` (${l.dependantName})` : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

type Dlg = { kind: 'approve' | 'reject' } | { kind: 'cancel' } | { kind: 'undo' } | { kind: 'zip' } | null;

export default function ClaimView({ claim: c, mode, backHref }: { claim: ClaimDetail; mode: 'own' | 'approver'; backHref?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [own, setOwn] = React.useState<OwnClaimTarget | null>(null);
  const [dlg, setDlg] = React.useState<Dlg>(null);
  const [viewer, setViewer] = React.useState<number | null>(null);
  const t = c.task;
  const decided = c.alreadyDecided;
  const allFiles: ViewerFile[] = c.lines.flatMap((l) => l.files.map((f) => ({ ...f, label: `Line ${l.lineNo}` })));
  const openFile = (fileId: string) => setViewer(Math.max(0, allFiles.findIndex((f) => f.fileId === fileId)));
  const base = { claimId: c.id, claimNo: c.claimNo, version: c.version, editHref: `/my/claims/${encodeURIComponent(c.claimNo)}/edit` };
  const showTax = c.lines.some((l) => l.taxTreatment || l.glAccount);
  const d = c.disbursement;

  // ---- actions -------------------------------------------------------------------------------
  const ownBtns = mode === 'own' && (
    <>
      {c.can.delete && (
        <Button variant="text" color="error" onClick={() => setOwn({ kind: 'delete', ...base })}>
          Delete
        </Button>
      )}
      {c.can.withdraw && (
        <Button variant="outlined" color="error" onClick={() => setOwn({ kind: 'withdraw', ...base })}>
          Withdraw
        </Button>
      )}
      {c.can.copy && (
        <Button variant="outlined" onClick={() => setOwn({ kind: 'copy', ...base })}>
          Copy to new claim
        </Button>
      )}
      {c.can.edit && (
        <Button variant="outlined" component={NextLink} href={base.editHref}>
          Edit
        </Button>
      )}
      {c.can.submit && (
        <Button variant="contained" onClick={() => setOwn({ kind: 'submit', ...base })}>
          Submit
        </Button>
      )}
    </>
  );
  const approverBtns = mode === 'approver' && (
    <>
      {c.can.downloadReceipts && allFiles.length > 0 && (
        <Button variant="text" onClick={() => setDlg({ kind: 'zip' })}>
          Download attachments
        </Button>
      )}
      {c.can.applyLateOverride && (
        <Button variant="text" component={NextLink} href={`/claims/late-overrides?new=1&employee=${encodeURIComponent(c.employee.id)}`}>
          Apply late override
        </Button>
      )}
      {c.can.undoDisbursement && (
        <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'undo' })}>
          Undo disbursement
        </Button>
      )}
      {c.can.cancel && (
        <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'cancel' })}>
          Cancel claim
        </Button>
      )}
      {!decided && t?.canDecide && (
        <>
          <Button variant="outlined" color="error" onClick={() => setDlg({ kind: 'reject' })}>
            Reject claim
          </Button>
          <Button variant="contained" onClick={() => setDlg({ kind: 'approve' })}>
            Approve claim
          </Button>
        </>
      )}
    </>
  );
  const hasActions =
    (mode === 'own' && (c.can.edit || c.can.submit || c.can.delete || c.can.withdraw || c.can.copy)) ||
    (mode === 'approver' && Boolean((!decided && t?.canDecide) || c.can.cancel || c.can.undoDisbursement || c.can.applyLateOverride || (c.can.downloadReceipts && allFiles.length > 0)));

  // ---- status timeline ---------------------------------------------------------------------
  const timeline: { label: string; at: string | null; note?: string | null }[] = [{ label: 'Created (New)', at: c.createdAt }];
  if (c.submittedAt) timeline.push({ label: 'Submitted', at: c.submittedAt });
  if (c.decision) timeline.push({ label: `${c.decision.outcome === 'approved' ? 'Approved' : 'Rejected'} by ${c.decision.byName}${c.decision.actingAs ? ` (${c.decision.actingAs})` : ''}`, at: c.decision.at, note: c.decision.reason });
  if (c.cancellation) timeline.push({ label: `Cancelled by ${c.cancellation.byName}`, at: c.cancellation.at, note: c.cancellation.reason });
  if (d?.batchNo) timeline.push({ label: `Included in batch ${d.batchNo}${d.plannedPaymentDate ? ` · planned payment ${formatDate(d.plannedPaymentDate)}` : ''}`, at: null });
  if (d?.disbursedOn) timeline.push({ label: `Disbursed ${formatDate(d.disbursedOn)}${d.paymentReference ? ` · HLB ref ${d.paymentReference}` : ''}`, at: null });
  if (d?.undoneReason) timeline.push({ label: `Payment reversed — ${d.undoneReason}; will be paid in the next batch`, at: null });

  const lineCols = [
    { key: 'n', header: 'Line', render: (l: ClaimLineView) => l.lineNo },
    { key: 'c', header: 'Category', render: (l: ClaimLineView) => l.category.name },
    { key: 'd', header: 'Date', render: (l: ClaimLineView) => formatDate(l.transactionDate) },
    { key: 'i', header: 'Description / merchant', render: (l: ClaimLineView) => lineInfo(l) || '—' },
    { key: 'r', header: 'Receipt no.', render: (l: ClaimLineView) => l.receiptNo ?? '—' },
    { key: 'u', header: 'UUID', render: (l: ClaimLineView) => l.myinvoisUuid ?? '—' },
    { key: 'km', header: 'km', align: 'right' as const, render: (l: ClaimLineView) => (l.distanceKm ? `${l.distanceKm} km${l.ratePerKm ? ` × RM ${l.ratePerKm}` : ''}` : '—') },
    { key: 'a', header: 'Amount (RM)', align: 'right' as const, render: (l: ClaimLineView) => <MoneyCell v={l.amountInclSst} /> },
    { key: 's', header: 'SST (RM)', align: 'right' as const, render: (l: ClaimLineView) => <MoneyCell v={l.sstAmount} /> },
    { key: 'f', header: 'Receipts', render: (l: ClaimLineView) => <ReceiptButtons files={l.files} onOpen={openFile} /> },
    {
      key: 'l',
      header: 'Limit result',
      render: (l: ClaimLineView) => (
        <Stack spacing={0.25}>
          <LimitChip check={l.limitCheck} compact />
          {l.duplicateWarnings.map((w) => (
            <Typography key={w} variant="body2" sx={{ color: '#B45309' }}>
              ⚠ {w}
            </Typography>
          ))}
          {l.lateOverride && <Typography variant="body2" sx={{ color: '#B45309' }}>Late (override)</Typography>}
        </Stack>
      ),
    },
    ...(showTax
      ? [
          { key: 't', header: 'Tax treatment / GL', render: (l: ClaimLineView) => [l.taxTreatment ? TAX_TREATMENT_LABELS[l.taxTreatment] : null, l.eaFormLine ? `EA ${l.eaFormLine}` : null, l.glAccount].filter(Boolean).join(' · ') || '—' },
          { key: 'cc', header: 'Cost centre', render: (l: ClaimLineView) => l.costCentre?.label ?? '—' },
        ]
      : []),
  ];

  return (
    <Stack spacing={2} sx={{ pb: hasActions ? { xs: 10, sm: 0 } : 0 }}>
      {decided && (
        <Alert severity="info">
          Already decided by {decided.byName} at {formatDateTime(decided.at)}.
        </Alert>
      )}
      {mode === 'approver' && c.isOwn && <Alert severity="info">You can&apos;t decide your own claim.</Alert>}
      {mode === 'approver' && !c.isOwn && !decided && c.blockedReason && <Alert severity="info">{c.blockedReason}</Alert>}
      {mode === 'approver' && t?.asDelegate && (
        <Alert severity="info" variant="outlined">
          You are acting as a delegate for this claim.
        </Alert>
      )}
      {mode === 'own' && c.staleNew && <Alert severity="warning">This claim was saved more than 90 days ago and is still not submitted.</Alert>}
      {mode === 'own' && c.status === 'submitted' && c.waitingFor && <Alert severity="info">Submitted — waiting for approval by {c.waitingFor}.</Alert>}

      {/* Header */}
      <Card>
        <CardContent sx={card}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
            <CopyRef value={c.claimNo} />
            <ClaimStatusChip status={c.status} />
            <ClaimFlags flags={c.flags} onBehalfName={c.onBehalfByName} />
            {c.copiedFrom && (
              <Chip
                size="small"
                variant="outlined"
                icon={<ContentCopyIcon />}
                label={`Copied from ${c.copiedFrom.claimNo}`}
                component={NextLink}
                href={mode === 'own' ? `/my/claims/${encodeURIComponent(c.copiedFrom.claimNo)}` : `/approvals/claims/${encodeURIComponent(c.copiedFrom.claimNo)}`}
                clickable
              />
            )}
          </Stack>
          {mode === 'approver' && (
            <Typography variant="body1" sx={{ mb: 0.5 }}>
              {c.employee.name} · {c.employee.employeeNo} · {c.employee.department} · {c.employee.position}
            </Typography>
          )}
          <Typography variant="h6" component="p">
            “{c.title}”
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {[c.projectRef ? `Project: ${c.projectRef}` : null, c.submittedAt ? `Submitted ${formatDateTime(c.submittedAt)}` : 'Not submitted', c.waitingWorkingDays !== null && c.status === 'submitted' ? `Waiting ${c.waitingWorkingDays} d` : null]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
          <Typography variant="body1" sx={{ mt: 1 }} className="pret-tnum">
            Total <MoneyText amount={c.totals.total} bold /> · SST <MoneyText amount={c.totals.sst} /> · Excl. SST <MoneyText amount={c.totals.exclSst} />
          </Typography>
          {c.onBehalfNote && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              On-behalf note: {c.onBehalfNote}
            </Typography>
          )}
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 8 }}>
          <Stack spacing={2}>
            <Card>
              <CardContent sx={card}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
                  <Typography variant="h5" component="h2" sx={{ flex: 1 }}>
                    Lines ({c.lines.length})
                  </Typography>
                  {mode === 'approver' && !c.isOwn && allFiles.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      Receipt viewing is logged
                    </Typography>
                  )}
                </Stack>
                <MiniTable caption="Claim lines" rows={c.lines} getRowId={(l) => l.id} columns={lineCols} />
                <Box sx={{ mt: 2, maxWidth: 360, ml: 'auto' }}>
                  <PanelRow label="Total excl. SST" value={formatMoney(c.totals.exclSst)} />
                  <PanelRow label="SST" value={formatMoney(c.totals.sst)} />
                  <PanelRow label="Total" value={formatMoney(c.totals.total)} strong />
                </Box>
              </CardContent>
            </Card>

            <Card>
              <CardContent sx={card}>
                <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                  Approval trail
                </Typography>
                <ApprovalTrail trail={c.trail} waitingFor={c.status === 'submitted' ? c.waitingFor : null} />
              </CardContent>
            </Card>

            {c.events.length > 0 && (
              <Card>
                <CardContent sx={card}>
                  <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
                    History
                  </Typography>
                  <MiniTable
                    caption="History"
                    rows={c.events}
                    getRowId={(e) => `${e.at}-${e.event}`}
                    columns={[
                      { key: 'at', header: 'At', render: (e) => formatDateTime(e.at) },
                      { key: 'e', header: 'Event', render: (e) => `${e.event}${e.batchNo ? ` (${e.batchNo})` : ''}` },
                      { key: 'by', header: 'By', render: (e) => e.actorName },
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
            <Card>
              <CardContent sx={card}>
                <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                  Status timeline
                </Typography>
                <Box component="ol" sx={{ m: 0, pl: 2.5 }}>
                  {timeline.map((s, i) => (
                    <Box component="li" key={i} sx={{ mb: 1 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {s.label}
                      </Typography>
                      {s.at && (
                        <Typography variant="caption" color="text.secondary" className="pret-tnum">
                          {formatDateTime(s.at)}
                        </Typography>
                      )}
                      {s.note && <Typography variant="body2">Reason: {s.note}</Typography>}
                    </Box>
                  ))}
                </Box>
                {d && (
                  <Box sx={{ mt: 1 }}>
                    {d.via && <PanelRow label="Disbursed via" value={DISBURSED_VIA_LABELS[d.via]} />}
                    {d.batchNo && (
                      <PanelRow
                        label="Batch"
                        value={
                          mode === 'approver' ? (
                            <Link component={NextLink} href={`/claims/batches/${encodeURIComponent(d.batchNo)}`}>
                              {d.batchNo}
                            </Link>
                          ) : (
                            d.batchNo
                          )
                        }
                      />
                    )}
                    {d.disbursedOn && <PanelRow label="Disbursed on" value={formatDate(d.disbursedOn)} />}
                    {d.paymentReference && <PanelRow label="Payment reference" value={d.paymentReference} />}
                  </Box>
                )}
              </CardContent>
            </Card>
            {mode === 'approver' && c.utilisation.length > 0 && (
              <Card>
                <CardContent sx={card}>
                  <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
                    {c.employee.name.split(' ')[0]}&apos;s limit utilisation
                  </Typography>
                  <MiniTable caption="Limit utilisation" rows={c.utilisation} getRowId={(r) => `${r.category.id}-${r.basis}`} columns={utilisationColumns()} />
                </CardContent>
              </Card>
            )}
            {mode === 'own' && c.utilisation.length > 0 && <UtilisationPanel u={{ asOf: c.updatedAt ?? '', rows: c.utilisation, unlimitedCategories: [] }} title="My limits" />}
          </Stack>
        </Grid>
      </Grid>

      <RecordFooter meta={c} />

      {hasActions && (
        <Box
          sx={{
            position: { xs: 'sticky', sm: 'static' },
            bottom: 'var(--pret-bottom-bar, 0px)',
            zIndex: 2,
            bgcolor: { xs: 'background.paper', sm: 'transparent' },
            borderTop: { xs: '1px solid', sm: 0 },
            borderColor: 'divider',
            mx: { xs: -2, sm: 0 },
            px: { xs: 2, sm: 0 },
            py: { xs: 1.5, sm: 0 },
          }}
        >
          <Stack direction="row" spacing={1} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
            {backHref && (
              <Button variant="text" component={NextLink} href={backHref} sx={{ mr: 'auto' }}>
                Back
              </Button>
            )}
            {ownBtns}
            {approverBtns}
          </Stack>
        </Box>
      )}

      <ReceiptViewer claimId={c.id} files={allFiles} index={viewer} onClose={() => setViewer(null)} logged={!c.isOwn} />
      <OwnClaimDialogs target={own} onClose={() => setOwn(null)} onDeleted={() => router.push('/my/claims')} />
      {(dlg?.kind === 'approve' || dlg?.kind === 'reject') && t && (
        <DecisionDialog
          open
          kind={dlg.kind}
          subject="claim"
          reference={c.claimNo}
          taskId={t.taskId}
          taskVersion={t.version}
          onClose={() => setDlg(null)}
          onDone={() => backHref && router.push(backHref)}
        />
      )}
      <ReasonDialog
        open={dlg?.kind === 'cancel'}
        title={`Cancel ${c.claimNo}?`}
        confirmLabel="Cancel claim"
        intro={`${c.employee.name} is notified with your reason. The claim (${formatMoney(c.totals.total)}) is removed from any open batch and will not be paid.`}
        onClose={() => setDlg(null)}
        onConfirm={async (reason) => {
          if (reason.length < 5) return toast.info('Reason must be at least 5 characters.');
          const res = await cancelClaim({ claimId: c.id, reason });
          if (res.ok) {
            toast.success(`${c.claimNo} cancelled.`);
            setDlg(null);
            router.refresh();
          } else toast.info(res.error);
        }}
      />
      <ReasonDialog
        open={dlg?.kind === 'undo'}
        title="Undo disbursement"
        confirmLabel="Undo disbursement"
        intro={`Undo disbursement of ${c.claimNo} (${formatMoney(c.totals.total)}${d?.batchNo ? `, ${d.batchNo}` : ''}${d?.paymentReference ? `, ref ${d.paymentReference}` : ''})? It returns to Approved and will be proposed for the next batch. Example reason: “Rejected by HLB — invalid account”.`}
        onClose={() => setDlg(null)}
        onConfirm={async (reason) => {
          if (reason.length < 5) return toast.info('Reason must be at least 5 characters.');
          const res = await undoDisbursement({ claimId: c.id, reason });
          if (res.ok) {
            toast.success(`Disbursement of ${c.claimNo} undone.`);
            setDlg(null);
            router.refresh();
          } else toast.info(res.error);
        }}
      />
      <AttachmentBundleDialog open={dlg?.kind === 'zip'} onClose={() => setDlg(null)} input={{ scope: 'filter', claimIds: [c.id] }} scopeLabel={c.claimNo} />
    </Stack>
  );
}
