'use client';

// E12 · Change requests queue — S-EM-12 · /employees/change-requests · F-EMP-19 · US-EMP-017.
// Search CR no., employee · Filters Status (default Submitted), Category (multi), Submitted
// from–to, Employee · Columns CR no. › · Employee · Category · Submitted at · Effective date ·
// Status ● · Attachments · ⋮ View / Approve / Reject · EXPORT .CSV. Own CRs: "Your request".
// E13 · Review — S-EM-13 · /employees/change-requests/{no} (also the P18 detail for the employee):
// header · changes table (Field · Current · Requested, masked + logged REVEAL · validation) ·
// CR4 · CR5 documents (logged) · CR6 · warnings · CR8 decision remarks (required to reject) ·
// REJECT / APPROVE. Requester = me → "You can't decide your own request."
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import {
  CR_CATEGORIES,
  CR_CATEGORY_LABELS,
  CR_STATUSES,
  CR_STATUS_LABELS,
  type ChangeRequestDetail,
  type ChangeRequestListParams,
  type ChangeRequestRow,
} from '@/server/contracts/employees';
import {
  cancelChangeRequest,
  decideChangeRequest,
  exportChangeRequestsCsv,
  getChangeRequestFileUrl,
  revealChangeRequestValue,
} from '@/server/actions/employees';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import { useToast } from '../ToastProvider';
import DateText from '../DateText';
import MaskedValue, { type RevealMode } from './MaskedValue';
import EmployeePicker from './EmployeePicker';
import { KVGrid, MiniTable } from './ui';
import { CrStatusChip, dateOr } from './labels';
import { CR_FILTERS } from './filters';
import { formatDate, formatDateTime } from '@/lib/format';
import { formatBytes } from './upload';

export function ChangeRequestsQueue({ rows, total, params }: { rows: ChangeRequestRow[]; total: number; params: ChangeRequestListParams }) {
  const list = useServerList({ filters: CR_FILTERS, sort: { key: 'submittedAt', direction: 'desc' } });
  const toast = useToast();
  const router = useRouter();
  const d = list.draft;
  const set = list.setDraftField;
  const href = (r: ChangeRequestRow) => `/employees/change-requests/${encodeURIComponent(r.crNo)}`;
  const columns: ListColumn<ChangeRequestRow>[] = [
    { key: 'crNo', header: 'CR no.', value: (r) => r.crNo },
    {
      key: 'employee',
      header: 'Employee',
      value: (r) => `${r.employee.name} (${r.employee.employeeNo})`,
      render: (r) => (
        <Stack direction="row" spacing={1} alignItems="center">
          <span>
            {r.employee.name} ({r.employee.employeeNo})
          </span>
          {r.isOwn && <Chip size="small" label="Your request" variant="outlined" />}
        </Stack>
      ),
    },
    { key: 'category', header: 'Category', value: (r) => CR_CATEGORY_LABELS[r.category] },
    { key: 'submittedAt', header: 'Submitted at', kind: 'date', value: (r) => formatDateTime(r.submittedAt), render: (r) => <DateText value={r.submittedAt} mode="datetime" /> },
    { key: 'effectiveDate', header: 'Effective date', kind: 'date', value: (r) => formatDate(r.effectiveDate), render: (r) => <DateText value={r.effectiveDate} /> },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => CR_STATUS_LABELS[r.status], render: (r) => <CrStatusChip status={r.status} /> },
    { key: 'attachments', header: 'Attachments', sortable: false, align: 'right', value: (r) => r.attachmentCount },
  ];
  return (
    <ListPage<ChangeRequestRow>
      itemName={{ singular: 'change request', plural: 'change requests' }}
      filters={[
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches CR no. and employee no. / name." />,
        <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={CR_STATUSES.map((s) => ({ value: s, label: CR_STATUS_LABELS[s] }))} />,
        <MultiSelectFilter key="c" label="Category" value={d.categories} onChange={(v) => set('categories', v)} options={CR_CATEGORIES.map((s) => ({ value: s, label: CR_CATEGORY_LABELS[s] }))} />,
        <DateFilter key="f" label="Submitted from" value={d.submittedFrom} onChange={(v) => set('submittedFrom', v)} />,
        <DateFilter key="t" label="Submitted to" value={d.submittedTo} onChange={(v) => set('submittedTo', v)} />,
        <EmployeePicker
          key="e"
          label="Employee"
          activeOnly={false}
          value={d.employeeId ? { id: d.employeeId, employeeNo: '', name: d.employeeName || 'Selected employee' } : null}
          onChange={(v) => {
            set('employeeId', v?.id ?? '');
            set('employeeName', v ? `${v.name}${v.employeeNo ? ` (${v.employeeNo})` : ''}` : '');
          }}
        />,
      ]}
      {...list.listProps}
      onExport={async () => {
        try {
          const res = await exportChangeRequestsCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'change-requests', res.content);
          else toast.info(res.error);
        } catch {
          toast.info('Export failed. Please try again.');
        }
      }}
      exportSensitive
      columns={columns}
      rows={rows}
      total={total}
      getRowId={(r) => r.id}
      getRowHref={href}
      getRowRef={(r) => r.crNo}
      rowActions={(r) => [
        { label: 'View', onClick: () => router.push(href(r)) },
        ...(r.status === 'submitted' && !r.isOwn
          ? [
              { label: 'Approve', onClick: () => router.push(`${href(r)}?decide=approve`) },
              { label: 'Reject', danger: true, onClick: () => router.push(`${href(r)}?decide=reject`) },
            ]
          : []),
      ]}
      empty={{ title: 'No change requests yet.' }}
    />
  );
}

/** Shared CR detail: HR review (mode 'hr') or the employee's own request (mode 'own', P18). */
export function ChangeRequestDetailView({ cr, mode, revealMode, initialDecision }: { cr: ChangeRequestDetail; mode: 'hr' | 'own'; revealMode: RevealMode; initialDecision?: 'approve' | 'reject' | null }) {
  const router = useRouter();
  const toast = useToast();
  const r = useActionRunner();
  const [remarks, setRemarks] = React.useState('');
  const [confirm, setConfirm] = React.useState<'approve' | 'reject' | 'cancel' | null>(null);
  const remarksRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (initialDecision) remarksRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [initialDecision]);

  const openFile = async (fileId: string) => {
    try {
      const res = await getChangeRequestFileUrl({ changeRequestId: cr.id, fileId });
      if (res.ok) window.open(res.url, '_blank', 'noopener');
      else toast.info(res.error);
    } catch {
      toast.info('Could not open the file.');
    }
  };
  const decide = async (decision: 'approve' | 'reject') => {
    if (decision === 'reject' && !remarks.trim()) {
      r.setFieldErrors({ remarks: 'Remarks are required to reject.' });
      setConfirm(null);
      return;
    }
    const res = await r.run(() => decideChangeRequest({ id: cr.id, decision, remarks, version: cr.version }), {
      success: (x) => {
        const v = x as unknown as { status: string; applied: boolean; appliesOn: string | null };
        if (decision === 'reject') return `${cr.crNo} rejected. The employee has been notified.`;
        return v.applied ? `${cr.crNo} approved and applied.` : `${cr.crNo} approved — applies on ${formatDate(v.appliesOn)}.`;
      },
    });
    setConfirm(null);
    if (res?.ok) router.refresh();
  };

  const hrDocsHidden = mode === 'own' && !cr.can.viewFiles && cr.files.length > 0;
  return (
    <Stack spacing={2}>
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
            <Typography variant="h4" component="p">
              {cr.crNo}
            </Typography>
            <CrStatusChip status={cr.status} />
            {cr.isOwn && mode === 'hr' && <Chip size="small" label="Your request" variant="outlined" />}
          </Stack>
          <KVGrid
            items={[
              {
                label: 'Employee',
                value:
                  mode === 'hr' ? (
                    <Link component={NextLink} href={`/employees/${encodeURIComponent(cr.employee.employeeNo)}`}>
                      {cr.employee.name} ({cr.employee.employeeNo})
                    </Link>
                  ) : (
                    `${cr.employee.name} (${cr.employee.employeeNo})`
                  ),
              },
              { label: 'Category', value: CR_CATEGORY_LABELS[cr.category] },
              { label: 'Submitted at', value: formatDateTime(cr.submittedAt) },
              { label: 'Effective date', value: dateOr(cr.effectiveDate) },
              { label: 'Decided by / at', value: cr.decidedAt ? `${cr.decidedByName ?? ''} · ${formatDateTime(cr.decidedAt)}` : '' },
              { label: 'Applied at', value: formatDateTime(cr.appliedAt), hidden: !cr.appliedAt },
            ]}
          />
        </CardContent>
      </Card>

      {cr.warnings.map((w) => (
        <Alert key={w} severity="warning" variant="outlined">
          {w}
        </Alert>
      ))}

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Changes
          </Typography>
          <MiniTable
            caption="Changes"
            rows={cr.items}
            getRowId={(i) => i.id}
            columns={[
              { key: 'f', header: 'Field', render: (i) => `${i.group ? `${i.group} · ` : ''}${i.label}${i.op === 'insert' ? ' (new)' : i.op === 'remove' ? ' (remove)' : ''}` },
              { key: 'c', header: 'Current value', render: (i) => i.currentDisplay ?? '—' },
              {
                key: 'n',
                header: 'Requested value',
                render: (i) =>
                  i.isSensitive && i.requestedDisplay && cr.can.reveal ? (
                    <MaskedValue
                      masked={i.requestedDisplay}
                      fieldLabel={i.label}
                      subject={cr.crNo}
                      mode={revealMode}
                      onReveal={async (reason) => {
                        const res = await revealChangeRequestValue({ itemId: i.id, reasonCode: (reason?.reasonCode as 'other' | undefined) ?? undefined, reasonText: reason?.reasonText ?? null });
                        return res.ok ? { ok: true as const, value: res.value } : { ok: false as const, error: res.error };
                      }}
                    />
                  ) : (
                    i.requestedDisplay ?? '—'
                  ),
              },
              ...(mode === 'hr' ? [{ key: 'v', header: 'Validation', render: (i: ChangeRequestDetail['items'][number]) => (i.validation.ok ? '✓ Valid' : `✕ ${i.validation.message ?? 'Invalid'}`) }] : []),
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
            Supporting documents & remarks
          </Typography>
          {hrDocsHidden ? (
            <Typography color="text.secondary">Attachment kept by HR.</Typography>
          ) : cr.files.length === 0 ? (
            <Typography color="text.secondary">No documents attached.</Typography>
          ) : (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {cr.files.map((f) => (
                <Button key={f.fileId} variant="outlined" startIcon={<AttachFileIcon />} onClick={() => openFile(f.fileId)} disabled={!cr.can.viewFiles}>
                  {f.fileName} · {formatBytes(f.sizeBytes)}
                </Button>
              ))}
            </Stack>
          )}
          {mode === 'hr' && cr.files.length > 0 && (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              Opening a document is logged.
            </Typography>
          )}
          <Box sx={{ mt: 2 }}>
            <KVGrid
              columns={2}
              items={[
                { label: 'Employee remarks', value: cr.employeeRemarks, full: true },
                { label: 'HR decision remarks', value: cr.decisionRemarks, full: true, hidden: cr.status === 'submitted' },
              ]}
            />
          </Box>
        </CardContent>
      </Card>

      {mode === 'hr' && cr.status === 'submitted' && (
        <Card ref={remarksRef}>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
              Decision
            </Typography>
            {!cr.can.decide ? (
              <Alert severity="info">{cr.isOwn ? "You can't decide your own request." : 'You cannot decide this request.'}</Alert>
            ) : (
              <>
                {r.error && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {r.error}
                  </Alert>
                )}
                <TextInput label="Remarks" value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={3} error={r.fieldErrors.remarks} helper="Required to reject. Shown to the employee." />
                <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
                  <Button variant="outlined" color="error" onClick={() => setConfirm('reject')} disabled={r.saving}>
                    Reject
                  </Button>
                  <Button variant="contained" onClick={() => setConfirm('approve')} disabled={r.saving}>
                    Approve
                  </Button>
                </Stack>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {mode === 'own' && cr.can.cancel && (
        <Stack direction="row" justifyContent="flex-end">
          <Button variant="outlined" color="error" onClick={() => setConfirm('cancel')}>
            Cancel request
          </Button>
        </Stack>
      )}

      <ConfirmDialog
        open={confirm === 'approve' || confirm === 'reject'}
        title={confirm === 'approve' ? `Approve ${cr.crNo}?` : `Reject ${cr.crNo}?`}
        body={
          confirm === 'approve'
            ? `The changes apply on ${formatDate(cr.effectiveDate)}${cr.category === 'bank_details' ? '; the employee (work and personal email) and the Super Admin are notified' : ''}.`
            : 'The employee is notified with your remarks.'
        }
        confirmLabel={confirm === 'approve' ? 'Approve' : 'Reject'}
        destructive={confirm === 'reject'}
        tone={confirm === 'approve' ? 'primary' : 'error'}
        onClose={() => setConfirm(null)}
        onConfirm={() => decide(confirm === 'approve' ? 'approve' : 'reject')}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        title={`Cancel ${cr.crNo}?`}
        body="HR will no longer review this request."
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        destructive
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const res = await r.run(() => cancelChangeRequest({ id: cr.id }), { success: `${cr.crNo} cancelled.` });
          setConfirm(null);
          if (res && !res.ok) toast.info(res.error);
        }}
      />
    </Stack>
  );
}
