'use client';

// Shared claims renderers (W2-005). Every enum, label and tone comes from the contract
// (src/server/contracts/claims.ts) — nothing re-invented here. Money via MoneyText (RM 1,234.56),
// dates dd/mm/yyyy, statuses via StatusChip (D12: New · Submitted · Approved · Disbursed · Rejected · Withdrawn · Cancelled).
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Collapse from '@mui/material/Collapse';
import Dialog from '@mui/material/Dialog';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RotateRightIcon from '@mui/icons-material/RotateRight';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import LockIcon from '@mui/icons-material/Lock';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  BATCH_STATUS_LABELS,
  CLAIM_FLAG_LABELS,
  CLAIM_FLAGS,
  CLAIM_STATUS_LABELS,
  CLAIM_STATUSES,
  type BatchStatus,
  type ClaimEmployeeOption,
  type ClaimFlag,
  type ClaimStatus,
  type DownloadUrl,
  type FileRef,
  type LimitCheck,
  type LimitUtilisation,
  type LimitUtilisationRow,
} from '@/server/contracts/claims';
import type { ActionResult } from '@/server/contracts/common';
import { confirmClaimUpload, getClaimReceiptUrl, requestClaimUpload, searchClaimEmployees } from '@/server/actions/claims';
import StatusChip, { type StatusValue } from '../StatusChip';
import MoneyText from '../MoneyText';
import { MiniTable } from '../employees/ui';
import { formatMonth } from '@/lib/format';
import { MAX_UPLOAD_BYTES, putToSignedUrl } from '@/lib/upload';
import type { Option } from '../forms/fields';
import type { LeaveUploadOutcome } from '../leave/upload';
import type { PickedPerson } from '../leave/pickers';

export const claimStatusText = (s: ClaimStatus) => CLAIM_STATUS_LABELS[s];
export const CLAIM_STATUS_OPTIONS: Option[] = CLAIM_STATUSES.map((s) => ({ value: s, label: CLAIM_STATUS_LABELS[s] }));
export const CLAIM_FLAG_OPTIONS: Option[] = CLAIM_FLAGS.map((f) => ({ value: f, label: CLAIM_FLAG_LABELS[f] }));

export function ClaimStatusChip({ status }: { status: ClaimStatus }) {
  return <StatusChip set="claim" value={CLAIM_STATUS_LABELS[status] as StatusValue<'claim'>} />;
}

export function BatchStatusChip({ status, outOfDate }: { status: BatchStatus; outOfDate?: boolean }) {
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap component="span">
      <StatusChip set="batch" value={BATCH_STATUS_LABELS[status] as StatusValue<'batch'>} />
      {outOfDate && <StatusChip set="batch" value="Outputs out of date" />}
    </Stack>
  );
}

/** CH9 flag chips (Over limit · Late (override) · Possible duplicate · On behalf). */
export function ClaimFlags({ flags, onBehalfName }: { flags: ClaimFlag[]; onBehalfName?: string | null }) {
  if (!flags.length) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap component="span">
      {flags.map((f) => (
        <StatusChip
          key={f}
          set="claim"
          value={CLAIM_FLAG_LABELS[f] as StatusValue<'claim'>}
          label={f === 'on_behalf' && onBehalfName ? `On behalf by ${onBehalfName}` : undefined}
        />
      ))}
    </Stack>
  );
}
export const flagsText = (flags: ClaimFlag[]) => flags.map((f) => CLAIM_FLAG_LABELS[f]).join(', ');

/** CLN16 limit result chip: ✓ within (green text) · ⚠ over (warning / blocked). */
export function LimitChip({ check, compact }: { check: LimitCheck | null | undefined; compact?: boolean }) {
  if (!check || check.status === 'no_limit') return compact ? <>—</> : null;
  const over = check.status === 'over';
  const color = over ? (check.blocking ? 'error.main' : 'warning.main') : 'success.main';
  const text = over ? `⚠ ${check.message}${check.blocking ? ' (blocked)' : ''}` : `✓ ${check.message}`;
  return (
    <Typography component="span" variant="body2" sx={{ color, fontWeight: 600 }}>
      {text}
    </Typography>
  );
}

/** "November 2027" from 'yyyy-mm-01' or 'yyyy-mm'. */
export function monthText(v: string | null | undefined): string {
  if (!v) return '';
  const iso = v.length === 7 ? `${v}-01` : v;
  return formatMonth(iso);
}

export function Money({ v, bold }: { v: string | number | null | undefined; bold?: boolean }) {
  return <MoneyText amount={v} bold={bold} />;
}
export function MoneyCell({ v }: { v: string | number | null | undefined }) {
  return <MoneyText amount={v} mode="table" />;
}

/** Opens a signed download URL returned by a registered Server Action. */
export async function openDownload(fn: () => Promise<ActionResult<DownloadUrl>>, onError: (msg: string) => void) {
  try {
    const res = await fn();
    if (res.ok) window.open(res.url, '_blank', 'noopener');
    else onError(res.error);
  } catch {
    onError('Could not open the file.');
  }
}

// ---------------------------------------------------------------------------------------------
// CLN15 receipts — two-step upload (ADR-0007): requestClaimUpload → PUT → confirmClaimUpload
// ---------------------------------------------------------------------------------------------
type ReceiptMime = 'image/jpeg' | 'image/png' | 'image/heic' | 'application/pdf';
function mimeOf(file: File): string {
  if (file.type) return file.type === 'image/jpg' ? 'image/jpeg' : file.type;
  const n = file.name.toLowerCase();
  if (n.endsWith('.heic') || n.endsWith('.heif')) return 'image/heic';
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

/** Phone photos: compress JPEG/PNG over ~2 MB on the device (canvas), keep the original if it fails (EC-PRT-04). */
async function compressImage(file: File): Promise<File> {
  const mime = mimeOf(file);
  if ((mime !== 'image/jpeg' && mime !== 'image/png') || file.size < 2 * 1024 * 1024 || typeof createImageBitmap === 'undefined') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export async function uploadClaimFile(original: File, opts: { employeeId?: string | null; categoryId?: string | null }): Promise<LeaveUploadOutcome> {
  const file = await compressImage(original);
  const mime = mimeOf(file);
  if (!['image/jpeg', 'image/png', 'image/heic', 'application/pdf'].includes(mime)) return { ok: false, error: 'Only JPG, PNG, HEIC or PDF up to 10 MB.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'Only JPG, PNG, HEIC or PDF up to 10 MB.' };
  try {
    const intent = await requestClaimUpload({
      employeeId: opts.employeeId ?? undefined,
      categoryId: opts.categoryId ?? undefined,
      fileName: file.name,
      mimeType: mime as ReceiptMime,
      sizeBytes: file.size,
    });
    if (!intent.ok) return { ok: false, error: Object.values(intent.fieldErrors ?? {})[0] ?? intent.error };
    if (!(await putToSignedUrl(intent.signedUrl, file))) return { ok: false, error: 'Upload failed — retry.' };
    const done = await confirmClaimUpload({ fileId: intent.fileId });
    return done.ok ? { ok: true, fileId: done.fileId } : { ok: false, error: done.error };
  } catch {
    return { ok: false, error: 'Upload failed — retry.' };
  }
}

// ---------------------------------------------------------------------------------------------
// Receipt viewer (interaction-notes §7): full screen, zoom, rotate, ‹ › between receipts, DOWNLOAD
// ---------------------------------------------------------------------------------------------
export type ViewerFile = FileRef & { label?: string };

export function ReceiptViewer({
  claimId,
  files,
  index,
  onClose,
  logged,
}: {
  claimId: string;
  files: ViewerFile[];
  index: number | null;
  onClose: () => void;
  /** "Viewing is logged" for anyone but the owner (BR-ADM-21). */
  logged?: boolean;
}) {
  const [i, setI] = React.useState(index ?? 0);
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [rot, setRot] = React.useState(0);
  React.useEffect(() => {
    if (index !== null) setI(index);
  }, [index]);
  const f = index !== null ? files[i] : undefined;
  const fileId = f?.fileId;
  React.useEffect(() => {
    if (!fileId) return;
    let alive = true;
    setUrl(null);
    setError(null);
    setZoom(1);
    setRot(0);
    getClaimReceiptUrl({ claimId, fileId })
      .then((res) => alive && (res.ok ? setUrl(res.url) : setError(res.error)))
      .catch(() => alive && setError('Could not open the receipt.'));
    return () => {
      alive = false;
    };
  }, [claimId, fileId]);
  if (!f) return null;
  const isPdf = f.mimeType === 'application/pdf';
  const isHeic = f.mimeType === 'image/heic';
  return (
    <Dialog open fullScreen onClose={onClose} aria-label={`Receipt ${i + 1} of ${files.length}`} slotProps={{ paper: { sx: { bgcolor: 'grey.900' } } }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, color: '#fff', bgcolor: 'grey.800' }}>
        <IconButton aria-label="Close viewer" onClick={onClose} sx={{ color: '#fff' }}>
          <CloseIcon />
        </IconButton>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
          {f.label ? `${f.label} · ` : ''}
          {f.fileName} ({i + 1} of {files.length})
          {logged && (
            <Box component="span" sx={{ ml: 1, display: 'inline-flex', alignItems: 'center', gap: 0.5, opacity: 0.8 }}>
              <LockIcon sx={{ fontSize: 14 }} /> Viewing is logged
            </Box>
          )}
        </Typography>
        {!isPdf && (
          <>
            <IconButton aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} sx={{ color: '#fff' }}>
              <ZoomOutIcon />
            </IconButton>
            <IconButton aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.25))} sx={{ color: '#fff' }}>
              <ZoomInIcon />
            </IconButton>
            <IconButton aria-label="Rotate" onClick={() => setRot((r) => (r + 90) % 360)} sx={{ color: '#fff' }}>
              <RotateRightIcon />
            </IconButton>
          </>
        )}
        {url && (
          <Tooltip title="Download">
            <IconButton aria-label="Download receipt" component="a" href={url} target="_blank" rel="noopener" sx={{ color: '#fff' }}>
              <FileDownloadOutlinedIcon />
            </IconButton>
          </Tooltip>
        )}
      </Stack>
      <Box
        sx={{ flex: 1, position: 'relative', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'pinch-zoom' }}
        onWheel={(e) => !isPdf && (e.ctrlKey || e.metaKey) && setZoom((z) => Math.min(4, Math.max(0.5, z - Math.sign(e.deltaY) * 0.1)))}
      >
        {error && <Alert severity="error">{error}</Alert>}
        {!error && !url && <Typography sx={{ color: '#fff' }}>Loading…</Typography>}
        {url && isPdf && <Box component="iframe" src={url} title={f.fileName} sx={{ width: '100%', height: '100%', border: 0, bgcolor: '#fff' }} />}
        {url && !isPdf && (
          <Box
            component="img"
            src={url}
            alt={`Receipt ${f.fileName}`}
            onError={() => isHeic && setError('This HEIC photo cannot be previewed in this browser — use Download.')}
            sx={{ maxWidth: '100%', maxHeight: '100%', transform: `scale(${zoom}) rotate(${rot}deg)`, transition: 'transform 150ms', transformOrigin: 'center' }}
          />
        )}
        {files.length > 1 && (
          <>
            <IconButton aria-label="Previous receipt" disabled={i === 0} onClick={() => setI((x) => x - 1)} sx={{ position: 'absolute', left: 8, color: '#fff', bgcolor: 'rgba(0,0,0,.4)' }}>
              <ChevronLeftIcon />
            </IconButton>
            <IconButton aria-label="Next receipt" disabled={i === files.length - 1} onClick={() => setI((x) => x + 1)} sx={{ position: 'absolute', right: 8, color: '#fff', bgcolor: 'rgba(0,0,0,.4)' }}>
              <ChevronRightIcon />
            </IconButton>
          </>
        )}
      </Box>
    </Dialog>
  );
}

/** "🧾 view" buttons for a line's receipts (opens the viewer at that file). */
export function ReceiptButtons({ files, onOpen }: { files: FileRef[]; onOpen: (fileId: string) => void }) {
  if (!files.length) return <>—</>;
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap component="span">
      {files.map((f, n) => (
        <Button key={f.fileId} size="small" variant="outlined" startIcon={<ReceiptLongOutlinedIcon />} onClick={() => onOpen(f.fileId)} sx={{ minHeight: 32 }}>
          {files.length > 1 ? `View ${n + 1}` : 'View'}
        </Button>
      ))}
    </Stack>
  );
}

// ---------------------------------------------------------------------------------------------
// C2 / C3 / C4 employee picker (searchClaimEmployees — ADM/SA; own record excluded by the server)
// ---------------------------------------------------------------------------------------------
export function ClaimEmployeePicker({
  label,
  value,
  onChange,
  required,
  error,
  helper,
  disabled,
  size,
}: {
  label: string;
  value: PickedPerson | null;
  onChange: (v: PickedPerson | null) => void;
  required?: boolean;
  error?: string;
  helper?: React.ReactNode;
  disabled?: boolean;
  size?: 'small' | 'medium';
}) {
  const [input, setInput] = React.useState('');
  const [options, setOptions] = React.useState<PickedPerson[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [enabled, setEnabled] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    const t = window.setTimeout(async () => {
      let rows: PickedPerson[] = [];
      try {
        const res = await searchClaimEmployees({ q: input.trim() || undefined, limit: 20 });
        if (res.ok) rows = res.rows.map((r: ClaimEmployeeOption) => ({ id: r.id, employeeNo: r.employeeNo, name: r.name, detail: [r.department, r.status].filter(Boolean).join(' · '), tag: r.note }));
      } catch {
        rows = [];
      }
      if (alive) {
        setOptions(rows);
        setLoading(false);
      }
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [input, enabled]);
  const opts = value && !options.some((o) => o.id === value.id) ? [value, ...options] : options;
  const lbl = (o: PickedPerson) => (o.employeeNo ? `${o.name} (${o.employeeNo})` : o.name);
  return (
    <Autocomplete
      options={opts}
      value={value}
      disabled={disabled}
      size={size}
      loading={loading}
      filterOptions={(x) => x}
      getOptionLabel={lbl}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      onChange={(_e, v) => onChange(v)}
      onOpen={() => setEnabled(true)}
      onInputChange={(_e, v, reason) => reason === 'input' && setInput(v)}
      noOptionsText="No matches"
      renderOption={(props, o) => {
        const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key?: React.Key };
        return (
          <Box component="li" key={key} {...rest}>
            <Box>
              <Typography variant="body2">{lbl(o)}</Typography>
              {(o.detail || o.tag) && (
                <Typography variant="caption" color="text.secondary">
                  {[o.detail, o.tag].filter(Boolean).join(' · ')}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
      renderInput={(params) => <TextField {...params} label={label} required={required} error={Boolean(error)} helperText={error ?? helper} />}
    />
  );
}

// ---------------------------------------------------------------------------------------------
// F-CLM-20 limit utilisation panel (P12, E3, P32, P29)
// ---------------------------------------------------------------------------------------------
export function utilisationColumns() {
  return [
    { key: 'c', header: 'Category', render: (r: LimitUtilisationRow) => r.category.name },
    { key: 'p', header: 'Period', render: (r: LimitUtilisationRow) => r.periodLabel },
    { key: 'u', header: 'Used (RM)', align: 'right' as const, render: (r: LimitUtilisationRow) => <MoneyCell v={r.used} /> },
    { key: 'l', header: 'Limit (RM)', align: 'right' as const, render: (r: LimitUtilisationRow) => <MoneyCell v={r.limit} /> },
    {
      key: 'r',
      header: 'Remaining (RM)',
      align: 'right' as const,
      render: (r: LimitUtilisationRow) => (
        <Box component="span" sx={{ color: Number(r.remaining) <= 0 ? 'error.main' : undefined }}>
          <MoneyCell v={r.remaining} />
        </Box>
      ),
    },
    { key: 'b', header: 'Behaviour', render: (r: LimitUtilisationRow) => (r.behaviour === 'block' ? 'Block' : 'Warn') },
  ];
}

export function UtilisationPanel({ u, title = 'Limit utilisation', defaultOpen = false }: { u: LimitUtilisation | null; title?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = React.useState(defaultOpen);
  if (!u) return null;
  const first = u.rows[0];
  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h6" component="h2" sx={{ flex: 1 }}>
            {title} ({u.asOf ? monthText(u.asOf.slice(0, 7)) : ''})
          </Typography>
          {u.rows.length > 0 && (
            <Button size="small" onClick={() => setOpen((o) => !o)} endIcon={<ExpandMoreIcon sx={{ transform: open ? 'rotate(180deg)' : undefined }} />} aria-expanded={open}>
              Details
            </Button>
          )}
        </Stack>
        {u.rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No limits apply to your claim categories.
          </Typography>
        ) : (
          !open &&
          first && (
            <Typography variant="body2" sx={{ mt: 0.5 }}>
              {first.category.name}: <Money v={first.used} /> used · limit <Money v={first.limit} /> {first.basis === 'transaction' ? 'per transaction' : first.periodLabel}
              {u.rows.length > 1 ? ` · +${u.rows.length - 1} more` : ''}
            </Typography>
          )
        )}
        <Collapse in={open} unmountOnExit>
          <Box sx={{ mt: 1 }}>
            <MiniTable caption="Limit utilisation" rows={u.rows} getRowId={(r) => `${r.category.id}-${r.basis}`} columns={utilisationColumns()} />
          </Box>
        </Collapse>
        {u.unlimitedCategories.length > 0 && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
            Other categories: no limit ({u.unlimitedCategories.length})
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

/** Year options (current ± range). */
export function claimYearOptions(current: number, back = 3): Option[] {
  const out: Option[] = [];
  for (let y = current; y >= current - back; y -= 1) out.push({ value: String(y), label: String(y) });
  return out;
}
