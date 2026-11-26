'use client';

// A16 detail — subject and body with placeholders (e.g. {reference}, {dates}, {link}).
// SA + editable: edit subject / body, PREVIEW with a synthetic sample, SAVE / RESET TO DEFAULT; guard "Placeholders for
// NRIC, bank account, salary or diagnosis are not available" (F-NTF-08). ADM (or a non-editable template): read-only.
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import LockIcon from '@mui/icons-material/Lock';
import {
  TEMPLATE_PLACEHOLDER_GUARD,
  type NotificationTemplateDetail,
  type RenderedEmail,
} from '@/server/contracts/notifications';
import { previewNotificationTemplate, resetNotificationTemplate, saveNotificationTemplate } from '@/server/actions/notifications';
import { KeyValue, TextInput } from '../forms/fields';
import { MiniTable } from '../employees/ui';
import ErrorSummary from '../forms/ErrorSummary';
import RecordFooter from '../forms/RecordFooter';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import PageTitle from '../shell/PageTitle';
import { useToast } from '../ToastProvider';

const tick = (b: boolean) => (b ? 'Yes' : 'No');

export default function TemplateDetail({ template, canEdit }: { template: NotificationTemplateDetail; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [t, setT] = React.useState(template);
  const [subject, setSubject] = React.useState(template.subject);
  const [body, setBody] = React.useState(template.body);
  const [preview, setPreview] = React.useState<RenderedEmail>(template.preview);
  const [busy, setBusy] = React.useState<'save' | 'preview' | 'reset' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [confirmReset, setConfirmReset] = React.useState(false);
  const editable = canEdit && t.editable;
  const dirty = subject !== t.subject || body !== t.body;

  const apply = (next: NotificationTemplateDetail) => {
    setT(next);
    setSubject(next.subject);
    setBody(next.body);
    setPreview(next.preview);
  };

  const runPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      const r = await previewNotificationTemplate({ templateCode: t.templateCode, subject, body });
      if (r.ok) setPreview(r.preview);
      else {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
      }
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    setFieldErrors({});
    try {
      const r = await saveNotificationTemplate({ templateCode: t.templateCode, subject, body });
      if (r.ok) {
        apply(r.template);
        toast.success('Template saved. New emails use it from now on.');
        router.refresh();
      } else {
        setError(r.error);
        setFieldErrors(r.fieldErrors ?? {});
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Stack spacing={2}>
      <PageTitle
        title={`${t.eventCode} · ${t.eventName}`}
        breadcrumbs={[{ label: 'Notification templates', href: '/notifications/templates' }, { label: t.eventCode }]}
      />
      <Card>
        <CardContent>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KeyValue label="Event" value={`${t.eventCode} · ${t.eventName}`} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <KeyValue label="Recipients" value={t.recipients} />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <KeyValue label="In-app" value={tick(t.inApp)} />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <KeyValue label="Action-required" value={t.mandatory ? 'Yes — cannot be switched off' : 'No'} />
            </Grid>
            <Grid size={{ xs: 12, md: 2 }}>
              <KeyValue label="Template" value={t.overridden ? 'Changed from default' : 'Default'} />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card component="section" aria-label="Subject and body">
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                <Typography variant="h5" component="h2">
                  Email content
                </Typography>
                {!editable && <LockIcon fontSize="small" aria-hidden sx={{ color: 'text.secondary' }} />}
              </Stack>
              {!editable && (
                <Alert severity="info" variant="outlined" icon={<LockIcon fontSize="inherit" />} sx={{ mb: 2 }}>
                  {canEdit ? 'This template is fixed and cannot be edited.' : 'Read-only. Only the Super Admin can edit templates.'}
                </Alert>
              )}
              <ErrorSummary error={error} fieldErrors={fieldErrors} labels={{ subject: 'Subject', body: 'Body' }} />
              <Stack spacing={2}>
                <TextInput label="Subject" required value={subject} onChange={setSubject} maxLength={150} disabled={!editable} error={fieldErrors.subject} />
                <TextInput
                  label="Body"
                  required
                  value={body}
                  onChange={setBody}
                  maxLength={2000}
                  multiline
                  minRows={8}
                  disabled={!editable}
                  error={fieldErrors.body}
                  helper={TEMPLATE_PLACEHOLDER_GUARD}
                />
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
                <Button variant="outlined" color="inherit" onClick={() => void runPreview()} loading={busy === 'preview'}>
                  Preview
                </Button>
                {editable && (
                  <>
                    <Box sx={{ flex: 1 }} />
                    <Button variant="outlined" color="inherit" disabled={!t.overridden || busy !== null} onClick={() => setConfirmReset(true)}>
                      Reset to default
                    </Button>
                    <Button variant="contained" disabled={!dirty} loading={busy === 'save'} onClick={() => void save()}>
                      Save
                    </Button>
                  </>
                )}
              </Stack>
              <Box sx={{ mt: 2 }}>
                <RecordFooter meta={{ updatedAt: t.updatedAt, updatedByName: t.updatedByName }} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card component="section" aria-label="Placeholders">
            <CardContent>
              <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
                Placeholders
              </Typography>
              <MiniTable
                caption="Placeholders"
                rows={t.placeholders}
                getRowId={(p) => p.key}
                empty="This template has no placeholders."
                columns={[
                  { key: 'k', header: 'Placeholder', render: (p) => <code>{`{${p.key}}`}</code> },
                  { key: 'l', header: 'Meaning', render: (p) => p.label },
                  { key: 's', header: 'Sample', render: (p) => p.sample },
                ]}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Card component="section" aria-label="Preview">
        <CardContent>
          <Typography variant="h5" component="h2">
            Preview (synthetic sample)
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Rendered with sample values only — no real employee data.
          </Typography>
          <KeyValue label="Subject" value={preview.subject} />
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                HTML
              </Typography>
              <Box
                component="iframe"
                title="Email preview (HTML)"
                sandbox=""
                srcDoc={preview.html}
                sx={{ width: '100%', minHeight: 360, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: '#fff' }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Plain text
              </Typography>
              <Box component="pre" sx={{ m: 0, p: 2, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '0.875rem', bgcolor: 'action.hover', borderRadius: 2, minHeight: 360 }}>
                {preview.text}
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title="Reset to the default template?"
        body="The subject and body go back to the PRET default. New emails use the default from now on."
        confirmLabel="Reset to default"
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          setBusy('reset');
          try {
            const r = await resetNotificationTemplate({ templateCode: t.templateCode });
            if (r.ok) {
              apply(r.template);
              toast.success('Template reset to the default.');
              router.refresh();
            } else toast.info(r.error);
          } finally {
            setBusy(null);
            setConfirmReset(false);
          }
        }}
      />
    </Stack>
  );
}
