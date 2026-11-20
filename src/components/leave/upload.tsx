'use client';

// Two-step uploads (ADR-0007) for leave attachments (LA11 MC/supporting documents), replacement-credit
// attachments (RC6) and balance-adjustment attachments (L5):
// request…Upload (registered Server Action) → browser PUT to the signed URL → confirmLeaveUpload.
// Plus the attachment picker used by P2 / L2 / P4 (TAKE PHOTO + CHOOSE FILE, thumbnails with ✕, max 3).
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormHelperText from '@mui/material/FormHelperText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { confirmLeaveUpload, requestAdjustmentUpload, requestCreditUpload, requestLeaveUpload } from '@/server/actions/leave';
import { MAX_UPLOAD_BYTES, putToSignedUrl } from '@/lib/upload';

export type LeaveUploadOutcome = { ok: true; fileId: string } | { ok: false; error: string };
export type UploadedFile = { fileId: string; fileName: string; sizeBytes: number };

type LeaveMime = 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';
export const LEAVE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic';

function mimeOf(file: File): string {
  if (file.type) return file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith('.heic')) return 'image/heic';
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

export function precheckLeaveFile(file: File, allowHeic = true): string | null {
  const mime = mimeOf(file);
  const allowed = allowHeic ? ['image/jpeg', 'image/png', 'image/heic', 'application/pdf'] : ['image/jpeg', 'image/png', 'application/pdf'];
  if (!allowed.includes(mime)) return allowHeic ? 'Upload a JPEG, PNG, HEIC or PDF.' : 'Upload a JPEG, PNG or PDF.';
  if (file.size > MAX_UPLOAD_BYTES) return 'The file must be 10 MB or smaller.';
  return null;
}

async function finish(intent: { ok: true; signedUrl: string; fileId: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }, file: File): Promise<LeaveUploadOutcome> {
  if (!intent.ok) return { ok: false, error: Object.values(intent.fieldErrors ?? {})[0] ?? intent.error };
  if (!(await putToSignedUrl(intent.signedUrl, file))) return { ok: false, error: 'Upload failed. Please try again.' };
  const done = await confirmLeaveUpload({ fileId: intent.fileId });
  return done.ok ? { ok: true, fileId: done.fileId } : { ok: false, error: done.error };
}

/** LA11 — leaveTypeId decides the data category (health for SL/HL/ML); employeeId for on-behalf. */
export async function uploadLeaveFile(file: File, leaveTypeId: string, employeeId?: string | null): Promise<LeaveUploadOutcome> {
  const pre = precheckLeaveFile(file);
  if (pre) return { ok: false, error: pre };
  try {
    const intent = await requestLeaveUpload({ leaveTypeId, employeeId: employeeId ?? undefined, fileName: file.name, mimeType: mimeOf(file) as LeaveMime, sizeBytes: file.size });
    return await finish(intent, file);
  } catch {
    return { ok: false, error: 'Upload failed. Please try again.' };
  }
}

/** RC6 — leaveTypeId = the Replacement (RL) type. */
export async function uploadCreditFile(file: File, leaveTypeId: string): Promise<LeaveUploadOutcome> {
  const pre = precheckLeaveFile(file);
  if (pre) return { ok: false, error: pre };
  try {
    const intent = await requestCreditUpload({ leaveTypeId, fileName: file.name, mimeType: mimeOf(file) as LeaveMime, sizeBytes: file.size });
    return await finish(intent, file);
  } catch {
    return { ok: false, error: 'Upload failed. Please try again.' };
  }
}

/** L5 attachment. */
export async function uploadAdjustmentFile(file: File, employeeId: string): Promise<LeaveUploadOutcome> {
  const pre = precheckLeaveFile(file, false);
  if (pre) return { ok: false, error: pre };
  try {
    const intent = await requestAdjustmentUpload({ employeeId, fileName: file.name, mimeType: mimeOf(file) as 'image/jpeg' | 'image/png' | 'application/pdf', sizeBytes: file.size });
    return await finish(intent, file);
  } catch {
    return { ok: false, error: 'Upload failed. Please try again.' };
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Attachment field: TAKE PHOTO (camera on phones) · CHOOSE FILE · uploaded files as chips with ✕ ·
 * "n of max" counter. Uploads immediately; the parent keeps the confirmed file ids.
 */
export function AttachmentPicker({
  label,
  required,
  max = 3,
  files,
  onChange,
  upload,
  disabled,
  error,
  helper,
  camera = true,
}: {
  label: string;
  required?: boolean;
  max?: number;
  files: UploadedFile[];
  onChange: (files: UploadedFile[]) => void;
  upload: (file: File) => Promise<LeaveUploadOutcome>;
  disabled?: boolean;
  error?: string;
  helper?: React.ReactNode;
  camera?: boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const camRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const full = files.length >= max;

  const onPick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setLocalError(null);
    setBusy(true);
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= max) {
        setLocalError(`At most ${max} files.`);
        break;
      }
      const res = await upload(f);
      if (res.ok) next.push({ fileId: res.fileId, fileName: f.name, sizeBytes: f.size });
      else {
        setLocalError(res.error);
        break;
      }
    }
    onChange(next);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
  };

  const err = error ?? localError ?? undefined;
  return (
    <Box>
      <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
        {label}
        {required ? ' *' : ''}
        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
          {files.length} of {max}
        </Typography>
      </Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {camera && (
          <Button variant="outlined" startIcon={<PhotoCameraOutlinedIcon />} onClick={() => camRef.current?.click()} disabled={disabled || busy || full} sx={{ minHeight: 44 }}>
            Take photo
          </Button>
        )}
        <Button variant="outlined" startIcon={<AttachFileIcon />} onClick={() => fileRef.current?.click()} disabled={disabled || busy || full} loading={busy} loadingPosition="start" sx={{ minHeight: 44 }}>
          {busy ? 'Uploading…' : 'Choose file'}
        </Button>
        <input ref={fileRef} type="file" hidden accept={LEAVE_ACCEPT} multiple={max > 1} onChange={(e) => void onPick(e.target.files)} aria-label={`${label}: choose file`} />
        <input ref={camRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => void onPick(e.target.files)} aria-label={`${label}: take photo`} />
      </Stack>
      {files.length > 0 && (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {files.map((f) => (
            <Chip
              key={f.fileId}
              icon={<AttachFileIcon />}
              label={`${f.fileName} · ${formatBytes(f.sizeBytes)}`}
              onDelete={disabled ? undefined : () => onChange(files.filter((x) => x.fileId !== f.fileId))}
              variant="outlined"
            />
          ))}
        </Stack>
      )}
      {(err || helper) && <FormHelperText error={Boolean(err)}>{err ?? helper}</FormHelperText>}
    </Box>
  );
}
