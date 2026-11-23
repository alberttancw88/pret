'use client';

// G7 · S-GL-09 · /privacy-notice · F-ADM-15 · US-ADMIN-015 — every signed-in user.
// Current notice: Title · Effective date · Body text and/or embedded PDF with DOWNLOAD PDF.
// "Previous versions" → Title · Effective date · Replaced on · View. No acknowledgement (D14).
// None published → "No privacy notice has been published."
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import type { PrivacyNotice } from '@/server/contracts/users';
import { getPrivacyNoticeFileUrl } from '@/server/actions/users';
import { MiniTable } from '../employees/ui';
import DateText from '../DateText';
import EmptyState from '../EmptyState';
import { useToast } from '../ToastProvider';
import PageTitle from '../shell/PageTitle';
import PolicyOutlinedIcon from '@mui/icons-material/PolicyOutlined';

export default function PrivacyNoticeView({ notice, history, viewingOld }: { notice: PrivacyNotice | null; history: PrivacyNotice[]; viewingOld: boolean }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const toast = useToast();
  const [pdfUrl, setPdfUrl] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Embed the PDF (desktop) through a short-lived signed URL fetched on view.
  React.useEffect(() => {
    setPdfUrl(null);
    if (!notice?.fileId || phone) return;
    let alive = true;
    (async () => {
      try {
        const res = await getPrivacyNoticeFileUrl({ noticeId: notice.id });
        if (alive && res.ok) setPdfUrl(res.url);
      } catch {
        /* DOWNLOAD PDF still works */
      }
    })();
    return () => {
      alive = false;
    };
  }, [notice?.id, notice?.fileId, phone]);

  const download = async () => {
    if (!notice) return;
    setBusy(true);
    try {
      const res = await getPrivacyNoticeFileUrl({ noticeId: notice.id });
      if (res.ok) {
        const a = document.createElement('a');
        a.href = res.url;
        a.download = res.fileName;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else toast.info(res.error);
    } catch {
      toast.info("Couldn't open the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const previous = history.filter((h) => !h.isCurrent);

  if (!notice) {
    return (
      <Card>
        <EmptyState title="No privacy notice has been published." icon={PolicyOutlinedIcon} />
      </Card>
    );
  }

  const paragraphs = (notice.bodyText ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  return (
    <Stack spacing={2}>
      {viewingOld && <PageTitle title="Privacy notice (previous version)" breadcrumbs={[{ label: 'Privacy notice', href: '/privacy-notice' }]} />}
      {viewingOld && (
        <Alert severity="info" action={<Button component={NextLink} href="/privacy-notice" color="inherit" size="small">Current notice</Button>}>
          This is a previous version{notice.supersededAt ? <>, replaced on <DateText value={notice.supersededAt} /></> : null}.
        </Alert>
      )}
      <Card component="article" aria-labelledby="notice-title">
        <CardContent>
          <Typography id="notice-title" variant="h3" component="h2" sx={{ overflowWrap: 'anywhere' }}>
            {notice.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Effective <DateText value={notice.effectiveDate} />
          </Typography>
          {paragraphs.length > 0 && (
            <Box sx={{ mt: 2, maxWidth: 760 }}>
              {paragraphs.map((p, i) => (
                <Typography key={i} variant="body1" sx={{ mb: 1.5, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>
                  {p}
                </Typography>
              ))}
            </Box>
          )}
          {notice.fileId && (
            <Box sx={{ mt: 2 }}>
              <Button variant="outlined" color="primary" startIcon={<FileDownloadOutlinedIcon />} onClick={download} loading={busy} sx={{ width: { xs: '100%', sm: 'auto' } }}>
                Download PDF
              </Button>
              {pdfUrl && !phone && (
                <Box
                  component="iframe"
                  src={pdfUrl}
                  title={`${notice.title} (PDF)`}
                  sx={{ display: 'block', mt: 2, width: '100%', height: '75vh', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}
                />
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {previous.length > 0 && (
        <Card>
          <CardContent>
            <Typography variant="h6" component="h2" sx={{ mb: 1.5 }}>
              Previous versions
            </Typography>
            <MiniTable<PrivacyNotice>
              caption="Previous versions"
              columns={[
                { key: 'title', header: 'Title', render: (h) => h.title },
                { key: 'effective', header: 'Effective date', render: (h) => <DateText value={h.effectiveDate} /> },
                { key: 'replaced', header: 'Replaced on', render: (h) => <DateText value={h.supersededAt} /> },
              ]}
              rows={previous}
              getRowId={(h) => h.id}
              rowActions={(h) => (
                <Link component={NextLink} href={`/privacy-notice?version=${h.id}`} sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}>
                  View
                </Link>
              )}
            />
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
