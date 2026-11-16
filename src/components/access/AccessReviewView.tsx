'use client';

// A10 · Access review — S-AC-07 · /audit/access-review · F-ADM-12 · US-ADMIN-012 · SA.
// Month selector *. Sections: Users (User · Type · Roles · Status · Last login · Days since login) ·
// External users (Provider · Access end · Records opened · Sensitive views · Exports) · Flags (bank
// change + payment-list export by the same user within 7 days — EC-ADM-04 · changes to an SA's own
// compensation (R1.1) · privileged role changes) · MARK REVIEWED (remarks; by/at) · EXPORT .CSV.
import * as React from 'react';
import NextLink from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import LockIcon from '@mui/icons-material/Lock';
import { USER_TYPE_LABELS, type AccessReview } from '@/server/contracts/users';
import { exportAccessReviewCsv, markAccessReviewed } from '@/server/actions/users';
import StatusChip from '../StatusChip';
import DateText from '../DateText';
import EmptyState from '../EmptyState';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import ErrorSummary from '../forms/ErrorSummary';
import { useActionRunner } from '../forms/useActionRunner';
import { downloadServerCsv } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import { userStatusLabel } from './labels';
import { formatDateTime, formatMonth } from '@/lib/format';

const FLAG_LABELS: Record<AccessReview['flags'][number]['kind'], string> = {
  bank_change_and_payment_export: 'Bank change and payment-list export by the same user within 7 days',
  sa_own_compensation_change: "Change to a Super Admin's own compensation (R1.1)",
  privileged_role_change: 'Privileged role change',
};

function Section({ id, title, count, children }: { id: string; title: string; count?: number; children: React.ReactNode }) {
  return (
    <Card component="section" aria-labelledby={id}>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography id={id} variant="h5" component="h2" sx={{ mb: 2 }}>
          {title}
          {count !== undefined ? ` (${count})` : ''}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

export default function AccessReviewView({ review, months }: { review: AccessReview; months: string[] }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const toast = useToast();
  const [pending, start] = React.useTransition();
  const [markOpen, setMarkOpen] = React.useState(false);
  const [remarks, setRemarks] = React.useState('');
  const markRun = useActionRunner();
  const [exporting, setExporting] = React.useState(false);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await exportAccessReviewCsv({ month: review.month });
      if (res.ok) downloadServerCsv(res.filename || `access-review-${review.month}`, res.content);
      else toast.info(res.error);
    } catch {
      toast.info('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
            <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap" useFlexGap>
              <TextField
                select
                label="Month *"
                value={review.month}
                onChange={(e) => start(() => router.replace(`${pathname}?month=${e.target.value}`, { scroll: false }))}
                sx={{ minWidth: 160 }}
              >
                {months.map((m) => (
                  <MenuItem key={m} value={m}>
                    {formatMonth(`${m}-01`)}
                  </MenuItem>
                ))}
              </TextField>
              <StatusChip set="accessReview" value={review.review ? 'Reviewed' : 'Not reviewed'} />
              {review.review && (
                <Typography variant="body2" color="text.secondary">
                  Reviewed by {review.review.reviewedByName ?? 'System'} at {formatDateTime(review.review.reviewedAt)}
                </Typography>
              )}
            </Stack>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" color="success" startIcon={<LockIcon />} onClick={exportCsv} loading={exporting} loadingPosition="start">
                {exporting ? 'Preparing…' : 'Export .CSV'}
              </Button>
              {!review.review && (
                <Button variant="contained" onClick={() => (markRun.reset(), setRemarks(''), setMarkOpen(true))}>
                  Mark reviewed
                </Button>
              )}
            </Stack>
          </Stack>
          {review.review?.remarks && (
            <Alert severity="info" variant="outlined" sx={{ mt: 2 }}>
              Remarks: {review.review.remarks}
            </Alert>
          )}
          {pending && <LinearProgress aria-label="Loading" sx={{ mt: 2 }} />}
        </CardContent>
      </Card>

      <Section id="ar-flags" title="Flags" count={review.flags.length}>
        {review.flags.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No flags for {formatMonth(`${review.month}-01`)}.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Flags" sx={{ minWidth: 560 }}>
              <TableHead>
                <TableRow>
                  <TableCell>When</TableCell>
                  <TableCell>Flag</TableCell>
                  <TableCell>User</TableCell>
                  <TableCell>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {review.flags.map((f, i) => (
                  <TableRow key={`${f.kind}-${f.occurredAt}-${i}`}>
                    <TableCell>
                      <DateText value={f.occurredAt} mode="datetime" />
                    </TableCell>
                    <TableCell>{FLAG_LABELS[f.kind]}</TableCell>
                    <TableCell>{f.actorName ?? '—'}</TableCell>
                    <TableCell>{f.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      <Section id="ar-users" title="Users" count={review.users.length}>
        {review.users.length === 0 ? (
          <EmptyState title="No users." minHeight={120} />
        ) : (
          <TableContainer>
            <Table size="small" aria-label="Users" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Roles</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Last login</TableCell>
                  <TableCell align="right">Days since login</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {review.users.map((u) => (
                  <TableRow key={u.userId} hover>
                    <TableCell>
                      <Link component={NextLink} href={`/users/${u.userId}`}>
                        {u.displayName}
                      </Link>
                    </TableCell>
                    <TableCell>{USER_TYPE_LABELS[u.userType]}</TableCell>
                    <TableCell>{u.roles.join(', ') || '—'}</TableCell>
                    <TableCell>
                      <StatusChip set="user" value={userStatusLabel(u.status)} />
                    </TableCell>
                    <TableCell>
                      <DateText value={u.lastLoginAt} mode="datetime" empty="Never" />
                    </TableCell>
                    <TableCell align="right" className="pret-tnum" sx={{ color: (u.daysSinceLogin ?? 0) > 60 ? '#B42318' : undefined }}>
                      {u.daysSinceLogin ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      <Section id="ar-ext" title="External users" count={review.externalUsers.length}>
        {review.externalUsers.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No external administrators.
          </Typography>
        ) : (
          <TableContainer>
            <Table size="small" aria-label="External users" sx={{ minWidth: 640 }}>
              <TableHead>
                <TableRow>
                  <TableCell>User</TableCell>
                  <TableCell>Provider</TableCell>
                  <TableCell>Access end</TableCell>
                  <TableCell align="right">Records opened</TableCell>
                  <TableCell align="right">Sensitive views</TableCell>
                  <TableCell align="right">Exports</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {review.externalUsers.map((u) => (
                  <TableRow key={u.userId} hover>
                    <TableCell>
                      <Link component={NextLink} href={`/users/${u.userId}`}>
                        {u.displayName}
                      </Link>
                    </TableCell>
                    <TableCell>{u.serviceProvider ?? '—'}</TableCell>
                    <TableCell>
                      <DateText value={u.accessEndDate} />
                    </TableCell>
                    <TableCell align="right" className="pret-tnum">
                      {u.recordsOpened}
                    </TableCell>
                    <TableCell align="right" className="pret-tnum">
                      {u.sensitiveViews}
                    </TableCell>
                    <TableCell align="right" className="pret-tnum">
                      {u.exports}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Section>

      <ResponsiveDialog
        open={markOpen}
        onClose={() => !markRun.saving && setMarkOpen(false)}
        title={`Mark ${formatMonth(`${review.month}-01`)} as reviewed?`}
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setMarkOpen(false)} disabled={markRun.saving}>
              Cancel
            </Button>
            <Button
              variant="contained"
              loading={markRun.saving}
              onClick={async () => {
                const res = await markRun.run(() => markAccessReviewed({ month: review.month, remarks }), {
                  success: `${formatMonth(`${review.month}-01`)} access review marked as reviewed.`,
                });
                if (res?.ok) setMarkOpen(false);
              }}
            >
              Mark reviewed
            </Button>
          </>
        }
      >
        {markRun.error && <ErrorSummary error={markRun.error} fieldErrors={markRun.fieldErrors} title="Not saved" />}
        <Typography sx={{ mb: 2 }}>Your name and the date are stored with the review.</Typography>
        <Box>
          <TextField
            fullWidth
            multiline
            minRows={3}
            label="Remarks"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value.slice(0, 1000))}
            helperText={`${remarks.length}/1000`}
          />
        </Box>
      </ResponsiveDialog>
    </Stack>
  );
}
