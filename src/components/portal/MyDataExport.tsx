'use client';

// P20 · S-PT-20 · /my/data-export · F-PRT-16 · US-PORTAL-016 (PDPA access / portability)
// Text "Download a copy of your personal data held in PRET: profile, family, leave, claims.
// The file is available here only (not emailed)." · [GENERATE MY DATA FILE] → list:
// Requested at · Status (Preparing / Ready / Expired) · DOWNLOAD · Available until.
// Generation and every download are access-logged on the server; the download is a
// 60-second signed URL fetched only when the user taps DOWNLOAD (never stored in the page).
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import LockIcon from '@mui/icons-material/Lock';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import {
  DATA_EXPORT_STATUS_LABELS,
  DATA_EXPORT_STATUS_TONE,
  type MyDataExportPage,
  type MyDataExportRow,
} from '@/server/contracts/portal';
import { downloadMyDataExport, fetchMyDataExports, generateMyDataExport } from '@/server/actions/portal';
import DateText from '../DateText';
import EmptyState from '../EmptyState';
import { useToast } from '../ToastProvider';
import { announceSessionEnded, SESSION_ENDED_MESSAGE } from '../forms/unsaved';
import { fileSize, ToneChip } from './common';

export default function MyDataExport({ initial }: { initial: MyDataExportPage }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = React.useState(initial);
  const [generating, setGenerating] = React.useState(false);
  const [downloading, setDownloading] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setData(initial), [initial]);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetchMyDataExports();
      if (res.ok) setData(res.page);
    } catch {
      /* keep the list on screen */
    }
  }, []);

  // A file still "Preparing" (e.g. generated in another tab) — re-check every 5 s.
  const preparing = data.rows.some((r) => r.status === 'preparing');
  React.useEffect(() => {
    if (!preparing) return;
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [preparing, refresh]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateMyDataExport();
      if (res.ok) {
        toast.success(res.export.status === 'ready' ? 'Your data file is ready to download.' : 'Your data file request was recorded.');
        await refresh();
        router.refresh();
      } else {
        if (res.error === SESSION_ENDED_MESSAGE) announceSessionEnded();
        setError(res.error);
        await refresh();
      }
    } catch {
      setError("Couldn't generate the file. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const download = async (row: MyDataExportRow) => {
    setDownloading(row.id);
    try {
      const res = await downloadMyDataExport({ id: row.id });
      if (res.ok) {
        const a = document.createElement('a');
        a.href = res.url;
        a.download = res.fileName;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        if (res.error === SESSION_ENDED_MESSAGE) announceSessionEnded();
        toast.info(res.error);
        await refresh();
      }
    } catch {
      toast.info("Couldn't start the download. Please try again.");
    } finally {
      setDownloading(null);
    }
  };

  const status = (r: MyDataExportRow) => <ToneChip label={DATA_EXPORT_STATUS_LABELS[r.status]} tone={DATA_EXPORT_STATUS_TONE[r.status]} />;
  const action = (r: MyDataExportRow) =>
    r.canDownload ? (
      <Tooltip title="Download is logged">
        <span>
          <Button
            variant="outlined"
            color="primary"
            size="small"
            startIcon={<FileDownloadOutlinedIcon />}
            onClick={() => download(r)}
            loading={downloading === r.id}
            loadingPosition="start"
            aria-label={`Download the data file requested at ${new Date(r.requestedAt).toLocaleString('en-GB')}`}
          >
            Download
          </Button>
        </span>
      </Tooltip>
    ) : r.status === 'failed' ? (
      <Typography variant="body2" color="error">
        {r.error ?? 'Generation failed.'}
      </Typography>
    ) : (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );

  const generateBtn = (
    <Tooltip title={!data.canGenerate && data.generateBlockedReason ? data.generateBlockedReason : ''} disableHoverListener={data.canGenerate}>
      <span>
        <Button
          variant="contained"
          onClick={generate}
          disabled={!data.canGenerate || generating}
          loading={generating}
          loadingPosition="start"
          startIcon={<LockIcon />}
          fullWidth={phone}
        >
          {generating ? 'Preparing…' : 'Generate my data file'}
        </Button>
      </span>
    </Tooltip>
  );

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Typography variant="h4" component="h2" sx={{ mb: 1 }}>
            Your personal data
          </Typography>
          <Typography variant="body1">{data.intro}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
            The file includes:
          </Typography>
          <Box component="ul" sx={{ mt: 0.5, mb: 1.5, pl: 3 }}>
            {data.sections.map((s) => (
              <Typography key={s} component="li" variant="body2">
                {s}
              </Typography>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary">
            One .zip with a machine-readable file (my-data.json) and a readable summary (PDF). It contains your full MyKad and bank
            account numbers — keep it safe. Each file can be downloaded for {data.availableDays} days. Generating and downloading are
            logged.
          </Typography>
          {!data.canGenerate && data.generateBlockedReason && (
            <Alert severity="info" sx={{ mt: 2 }}>
              {data.generateBlockedReason}
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mt: 2 }} role="alert">
              {error}
            </Alert>
          )}
          <Box sx={{ mt: 2, display: 'flex', justifyContent: { xs: 'stretch', sm: 'flex-start' } }}>{generateBtn}</Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent sx={{ pb: { xs: 2, sm: 1 } }}>
          <Typography variant="h6" component="h2">
            My data files
          </Typography>
        </CardContent>
        {data.rows.length === 0 ? (
          <EmptyState title="No data files yet." helper="Generate one above when you need a copy of your data." minHeight={160} />
        ) : phone ? (
          <Stack component="ul" spacing={1.5} sx={{ listStyle: 'none', m: 0, p: 2, pt: 0 }} aria-label="My data files">
            {data.rows.map((r) => (
              <Card component="li" key={r.id} variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                  <Box>
                    <Typography variant="caption" color="text.secondary" component="p">
                      Requested at
                    </Typography>
                    <Typography variant="body2" fontWeight={600}>
                      <DateText value={r.requestedAt} mode="datetime" />
                    </Typography>
                  </Box>
                  {status(r)}
                </Stack>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                  Available until
                </Typography>
                <Typography variant="body2">
                  <DateText value={r.availableUntil} mode="datetime" /> {r.sizeBytes ? `· ${fileSize(r.sizeBytes)}` : ''}
                </Typography>
                <Box sx={{ mt: 1.5, '& .MuiButton-root': { width: '100%' } }}>{action(r)}</Box>
              </Card>
            ))}
          </Stack>
        ) : (
          <TableContainer>
            <Table aria-label="My data files">
              <TableHead>
                <TableRow>
                  <TableCell>Requested at</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>File</TableCell>
                  <TableCell>Available until</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="pret-tnum" sx={{ whiteSpace: 'nowrap' }}>
                      <DateText value={r.requestedAt} mode="datetime" />
                    </TableCell>
                    <TableCell>{status(r)}</TableCell>
                    <TableCell>
                      {r.fileName ?? '—'}
                      {r.sizeBytes ? (
                        <Typography component="span" variant="caption" color="text.secondary">
                          {' '}
                          · {fileSize(r.sizeBytes)}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell className="pret-tnum" sx={{ whiteSpace: 'nowrap' }}>
                      <DateText value={r.availableUntil} mode="datetime" />
                    </TableCell>
                    <TableCell align="right">{action(r)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Stack>
  );
}
