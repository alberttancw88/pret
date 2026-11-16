'use client';

// A11 · Company privacy notice — S-AC-08 · /privacy/notice · F-ADM-15 · US-ADMIN-015 (ADM, SA).
// Current notice card (Title · Effective date · Published by/at · VIEW). PUBLISH NEW NOTICE form:
// Title * (100) · Body text and/or PDF (at least one) · Effective date * — "Publishing replaces the
// current notice; the old one is kept in history. No acknowledgement is collected." → N-55 (in-app).
// History list: Title · Effective date · Replaced on · Published by · VIEW.
// Body text is plain text (paragraphs separated by blank lines) — rendered as text, never HTML.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import type { PrivacyNotice } from '@/server/contracts/users';
import { confirmPrivacyNoticeUpload, getPrivacyNoticeFileUrl, publishPrivacyNotice, requestPrivacyNoticeUpload } from '@/server/actions/users';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField } from '../list/FilterFields';
import { csvFileName, downloadCsv, toCsv } from '../list/csv';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import FormCard from '../forms/FormCard';
import { DateInput, FormGrid, FullRow, KeyValue, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import DateText from '../DateText';
import { useToast } from '../ToastProvider';
import { formatDate, formatDateTime, todayMyt } from '@/lib/format';
import { MAX_UPLOAD_BYTES, putToSignedUrl } from '@/lib/upload';

function NoticeText({ text }: { text: string }) {
  return (
    <Stack spacing={1.5}>
      {text
        .split(/\n\s*\n/)
        .filter((p) => p.trim())
        .map((p, i) => (
          <Typography key={i} variant="body1" sx={{ whiteSpace: 'pre-line' }}>
            {p}
          </Typography>
        ))}
    </Stack>
  );
}

export default function PrivacyNoticeAdmin({ current, history }: { current: PrivacyNotice | null; history: PrivacyNotice[] }) {
  const toast = useToast();
  const [viewing, setViewing] = React.useState<PrivacyNotice | null>(null);
  const [opening, setOpening] = React.useState<string | null>(null);

  const openPdf = async (n: PrivacyNotice) => {
    setOpening(n.id);
    try {
      const res = await getPrivacyNoticeFileUrl({ noticeId: n.id });
      if (res.ok) window.open(res.url, '_blank', 'noopener,noreferrer');
      else toast.info(res.error);
    } finally {
      setOpening(null);
    }
  };
  const view = (n: PrivacyNotice) => (n.bodyText ? setViewing(n) : void openPdf(n));

  // ---- Publish form ------------------------------------------------------------
  const empty = { title: '', bodyText: '', effectiveDate: todayMyt() };
  const [form, setForm] = React.useState(empty);
  const [file, setFile] = React.useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const run = useActionRunner();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [local, setLocal] = React.useState<Record<string, string>>({});
  const errors = { ...run.fieldErrors, ...local };

  const upload = async (f: File) => {
    if (f.type !== 'application/pdf') return run.setError('Upload a PDF.');
    if (f.size > MAX_UPLOAD_BYTES) return run.setError('The file must be 10 MB or smaller.');
    setUploading(true);
    try {
      const intent = await requestPrivacyNoticeUpload({ fileName: f.name, mimeType: 'application/pdf', sizeBytes: f.size });
      if (!intent.ok) return run.setError(intent.error);
      if (!(await putToSignedUrl(intent.signedUrl, f))) return run.setError('Upload failed. Please try again.');
      const done = await confirmPrivacyNoticeUpload({ fileId: intent.fileId });
      if (!done.ok) return run.setError(done.error);
      setFile({ id: done.fileId, name: f.name });
    } finally {
      setUploading(false);
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.title.trim()) e.title = 'Title is required.';
    if (!form.bodyText.trim() && !file) e.bodyText = 'Enter body text or attach a PDF (at least one).';
    if (!form.effectiveDate) e.effectiveDate = 'Enter a date.';
    return e;
  };

  const publish = async () => {
    const res = await run.run(() => publishPrivacyNotice({ title: form.title, bodyText: form.bodyText, fileId: file?.id ?? null, effectiveDate: form.effectiveDate }), {
      success: 'Privacy notice published. Users see it in the portal menu.',
    });
    if (res?.ok) {
      setForm(empty);
      setFile(null);
    }
  };

  // ---- History list (client-side: a handful of rows) ------------------------------
  const [q, setQ] = React.useState('');
  const [applied, setApplied] = React.useState('');
  const [page, setPage] = React.useState(0);
  const [rpp, setRpp] = React.useState(25);
  const filtered = history.filter((n) => !applied || n.title.toLowerCase().includes(applied.toLowerCase()));
  const histCols: ListColumn<PrivacyNotice>[] = [
    { key: 'title', header: 'Title', sortable: false, value: (n) => n.title, minWidth: 200 },
    { key: 'effective', header: 'Effective date', kind: 'date', sortable: false, value: (n) => formatDate(n.effectiveDate), render: (n) => <DateText value={n.effectiveDate} /> },
    {
      key: 'replaced',
      header: 'Replaced on',
      kind: 'date',
      sortable: false,
      value: (n) => (n.isCurrent ? 'Current' : formatDate(n.supersededAt)),
      render: (n) => (n.isCurrent ? 'Current' : <DateText value={n.supersededAt} />),
    },
    { key: 'by', header: 'Published by', sortable: false, value: (n) => `${n.publishedByName ?? 'System'} · ${formatDateTime(n.publishedAt)}` },
    { key: 'format', header: 'Format', sortable: false, priority: 'low', value: (n) => [n.bodyText ? 'Text' : '', n.fileId ? 'PDF' : ''].filter(Boolean).join(' + ') },
  ];

  return (
    <Stack spacing={2}>
      <Card component="section" aria-labelledby="pn-current">
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography id="pn-current" variant="h5" component="h2" sx={{ mb: 2 }}>
            Current notice
          </Typography>
          {current ? (
            <Stack spacing={2}>
              <FormGrid>
                <KeyValue label="Title" value={current.title} />
                <KeyValue label="Effective date" value={<DateText value={current.effectiveDate} />} />
                <KeyValue label="Published by / at" value={`${current.publishedByName ?? 'System'} · ${formatDateTime(current.publishedAt)}`} />
                <KeyValue label="Format" value={[current.bodyText ? 'Text' : '', current.fileId ? `PDF (${current.fileName ?? 'file'})` : ''].filter(Boolean).join(' + ')} />
              </FormGrid>
              <Stack direction="row" spacing={1}>
                {current.bodyText && (
                  <Button variant="outlined" color="inherit" onClick={() => setViewing(current)}>
                    View
                  </Button>
                )}
                {current.fileId && (
                  <Button variant="outlined" color="inherit" startIcon={<AttachFileIcon />} onClick={() => openPdf(current)} loading={opening === current.id}>
                    Open PDF
                  </Button>
                )}
              </Stack>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No privacy notice has been published. Publishing one is optional; nothing blocks users without it.
            </Typography>
          )}
        </CardContent>
      </Card>

      <FormCard
        title="Publish new notice"
        subtitle="Publishing replaces the current notice; the old one is kept in history. No acknowledgement is collected."
        onSave={() => {
          const e = validate();
          setLocal(e);
          if (!Object.keys(e).length) setConfirm(true);
        }}
        saveLabel="Publish"
        saving={run.saving}
        dirty={Boolean(form.title || form.bodyText || file)}
        error={run.error}
        fieldErrors={errors}
        fieldLabels={{ title: 'Title', bodyText: 'Body text', fileId: 'PDF', effectiveDate: 'Effective date' }}
      >
        <FormGrid>
          <TextInput label="Title" required value={form.title} onChange={(v) => setForm({ ...form, title: v })} maxLength={100} error={errors.title} />
          <DateInput label="Effective date" required value={form.effectiveDate} onChange={(v) => setForm({ ...form, effectiveDate: v })} error={errors.effectiveDate} />
          <TextInput
            full
            label="Body text"
            value={form.bodyText}
            onChange={(v) => setForm({ ...form, bodyText: v })}
            maxLength={20000}
            multiline
            minRows={8}
            error={errors.bodyText}
            helper="Plain text; separate paragraphs with a blank line. Body text and/or a PDF is required."
          />
          <FullRow>
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <Button variant="outlined" color="inherit" startIcon={<UploadFileOutlinedIcon />} onClick={() => fileRef.current?.click()} loading={uploading} loadingPosition="start">
                {uploading ? 'Uploading…' : file ? 'Replace PDF' : 'Attach PDF'}
              </Button>
              {file ? (
                <Stack direction="row" spacing={1} alignItems="center">
                  <AttachFileIcon fontSize="small" aria-hidden />
                  <Typography variant="body2">{file.name}</Typography>
                  <Button size="small" variant="text" onClick={() => setFile(null)}>
                    Remove
                  </Button>
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  PDF up to 10 MB.
                </Typography>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void upload(f);
                }}
              />
            </Stack>
          </FullRow>
          <FullRow>
            <Alert severity="info" variant="outlined">
              All users get an in-app notice (no email). Nobody is blocked or asked to acknowledge (D14).
            </Alert>
          </FullRow>
        </FormGrid>
      </FormCard>

      <Box component="section" aria-labelledby="pn-history">
        <Typography id="pn-history" variant="h5" component="h2" sx={{ mb: 2 }}>
          History
        </Typography>
        <ListPage<PrivacyNotice>
          itemName={{ singular: 'notice', plural: 'notices' }}
          filters={[<KeywordField key="q" value={q} onChange={setQ} hint="Searches title" />]}
          activeFilterCount={applied ? 1 : 0}
          onSearch={() => {
            setApplied(q);
            setPage(0);
          }}
          onClear={() => {
            setQ('');
            setApplied('');
            setPage(0);
          }}
          onExport={() => downloadCsv(csvFileName('privacy-notices'), toCsv(histCols.map((c) => ({ header: c.header, value: (n: PrivacyNotice) => c.value!(n) })), filtered))}
          columns={histCols}
          rows={filtered.slice(page * rpp, page * rpp + rpp)}
          total={filtered.length}
          page={page}
          rowsPerPage={rpp}
          onPageChange={setPage}
          onRowsPerPageChange={(n) => {
            setRpp(n);
            setPage(0);
          }}
          getRowId={(n) => n.id}
          rowActions={(n) => [{ label: n.bodyText ? 'View' : 'Open PDF', onClick: () => view(n) }]}
          empty={{ title: 'No notices published yet.' }}
        />
      </Box>

      <ConfirmDialog
        open={confirm}
        title="Publish this privacy notice?"
        body={`"${form.title.trim()}" (effective ${formatDate(form.effectiveDate)}) replaces the current notice. The old one is kept in history. No acknowledgement is collected.`}
        confirmLabel="Publish"
        tone="success"
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await publish();
        }}
      />

      <ResponsiveDialog
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing?.title ?? ''}
        maxWidth="md"
        actions={
          <>
            {viewing?.fileId && (
              <Button variant="outlined" color="inherit" startIcon={<AttachFileIcon />} onClick={() => viewing && openPdf(viewing)}>
                Open PDF
              </Button>
            )}
            <Button variant="contained" onClick={() => setViewing(null)}>
              Close
            </Button>
          </>
        }
      >
        {viewing && (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              Effective {formatDate(viewing.effectiveDate)}
            </Typography>
            {viewing.bodyText && <NoticeText text={viewing.bodyText} />}
          </Stack>
        )}
      </ResponsiveDialog>
    </Stack>
  );
}
