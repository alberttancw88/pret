'use client';

// C3 · Bulk claim entry — S-CL-03 · /claims/bulk · F-CLM-28 (Could) · US-CLAIM-027
// Editable grid, one row = one line: Employee * · Claim title * (same employee + title = one claim) · Category * ·
// Transaction date * · Amount incl. SST * · SST · Receipt no. · UUID · Notes · Distance km · From / To / Purpose (mileage) ·
// Attachment (per row) · Row status (✓ / ✕ message). ADD ROW · paste from spreadsheet · VALIDATE · SUBMIT ALL (claims on behalf,
// Submitted, each validated as normal) → result table Claim no. · Employee · Lines · Total · Result. Desktop screen.
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import IconButton from '@mui/material/IconButton';
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { MILEAGE_RECEIPT_HINT, type BulkClaimPreview, type BulkClaimResult, type CategoryRow } from '@/server/contracts/claims';
import Tooltip from '@mui/material/Tooltip';
import { searchClaimEmployees, submitBulkClaims, validateBulkClaims } from '@/server/actions/claims';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { useToast } from '../ToastProvider';
import { MiniTable } from '../employees/ui';
import { parseDate } from '@/lib/format';
import { useIdempotencyKey } from '../leave/common';
import type { PickedPerson } from '../leave/pickers';
import { ClaimEmployeePicker, MoneyCell, uploadClaimFile } from './common';

type Row = {
  key: string;
  employee: PickedPerson | null;
  title: string;
  categoryId: string;
  transactionDate: string;
  amountInclSst: string;
  sstAmount: string;
  receiptNo: string;
  myinvoisUuid: string;
  description: string;
  distanceKm: string;
  fromPlace: string;
  toPlace: string;
  purpose: string;
  fileIds: string[];
  status: { ok: boolean; message: string | null } | null;
};
const k = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));
const blank = (): Row => ({ key: k(), employee: null, title: '', categoryId: '', transactionDate: '', amountInclSst: '', sstAmount: '', receiptNo: '', myinvoisUuid: '', description: '', distanceKm: '', fromPlace: '', toPlace: '', purpose: '', fileIds: [], status: null });

export default function BulkEntry({ categories }: { categories: CategoryRow[] }) {
  const toast = useToast();
  const [rows, setRows] = React.useState<Row[]>([blank(), blank(), blank()]);
  const [busy, setBusy] = React.useState<'validate' | 'submit' | null>(null);
  const [preview, setPreview] = React.useState<BulkClaimPreview | null>(null);
  const [result, setResult] = React.useState<BulkClaimResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [paste, setPaste] = React.useState<string | null>(null);
  const [key, renewKey] = useIdempotencyKey();
  const set = (i: number, p: Partial<Row>) => {
    setPreview(null);
    setRows((rs) => rs.map((r, n) => (n === i ? { ...r, ...p, status: null } : r)));
  };
  const catOf = (id: string) => categories.find((c) => c.id === id);
  const used = rows.filter((r) => r.employee || r.title || r.categoryId || r.amountInclSst || r.distanceKm);

  const input = () => ({
    idempotencyKey: key,
    rows: rows
      .map((r, i) => ({ r, rowNo: i + 1 }))
      .filter(({ r }) => used.includes(r))
      .map(({ r, rowNo }) => ({
        rowNo,
        employeeId: r.employee?.id ?? '',
        title: r.title,
        categoryId: r.categoryId,
        transactionDate: r.transactionDate,
        amountInclSst: catOf(r.categoryId)?.isMileage ? null : r.amountInclSst || null,
        sstAmount: r.sstAmount || null,
        receiptNo: r.receiptNo || null,
        myinvoisUuid: r.myinvoisUuid || null,
        description: r.description || null,
        distanceKm: catOf(r.categoryId)?.isMileage ? r.distanceKm || '' : null,
        fromPlace: r.fromPlace || null,
        toPlace: r.toPlace || null,
        purpose: r.purpose || null,
        merchant: null,
        fileIds: r.fileIds,
      })),
  });
  const applyStatuses = (res: { rowNo: number; ok: boolean; message: string | null }[]) =>
    setRows((rs) => rs.map((r, i) => ({ ...r, status: res.find((x) => x.rowNo === i + 1) ?? r.status })));
  const localCheck = () => {
    let ok = true;
    setRows((rs) =>
      rs.map((r) => {
        if (!used.includes(r)) return r;
        const m = !r.employee ? 'Select the employee.' : !r.title.trim() ? 'Enter the claim title.' : !r.categoryId ? 'Select the category.' : !r.transactionDate ? 'Enter the transaction date.' : catOf(r.categoryId)?.isMileage ? (!r.distanceKm ? 'Enter the distance (km).' : null) : !r.amountInclSst ? 'Enter the amount.' : null;
        if (m) ok = false;
        return m ? { ...r, status: { ok: false, message: m } } : r;
      }),
    );
    return ok && used.length > 0;
  };
  const validate = async () => {
    setError(null);
    if (!localCheck()) return setError(used.length ? 'Fix the rows marked ✕.' : 'Add at least one row.');
    setBusy('validate');
    try {
      const r = await validateBulkClaims(input());
      if (r.ok) {
        setPreview(r);
        applyStatuses(r.rows);
      } else setError(r.error);
    } finally {
      setBusy(null);
    }
  };
  const submit = async () => {
    setBusy('submit');
    setError(null);
    try {
      const r = await submitBulkClaims(input());
      if (r.ok) {
        setResult(r);
        renewKey();
        if (r.created) toast.success(`${r.created} claims created on behalf and submitted.`);
      } else setError(r.error);
    } finally {
      setBusy(null);
    }
  };

  /** Paste: tab-separated rows — Employee no. · Title · Category code or name · Date (dd/mm/yyyy) · Amount · SST · Receipt no. · UUID · Notes · km · From · To · Purpose */
  const applyPaste = async (text: string) => {
    const lines = text.split(/\r?\n/).map((l) => l.split('\t')).filter((c) => c.some((x) => x.trim()));
    const empNos = Array.from(new Set(lines.map((c) => (c[0] ?? '').trim()).filter(Boolean)));
    const found = new Map<string, PickedPerson>();
    for (const no of empNos) {
      try {
        const r = await searchClaimEmployees({ q: no, limit: 5 });
        const hit = r.ok ? r.rows.find((x) => x.employeeNo.toUpperCase() === no.toUpperCase()) : undefined;
        if (hit) found.set(no.toUpperCase(), { id: hit.id, employeeNo: hit.employeeNo, name: hit.name });
      } catch {
        /* unresolved → row shows ✕ */
      }
    }
    const findCat = (v: string) => categories.find((c) => c.code.toUpperCase() === v.trim().toUpperCase() || c.name.toLowerCase() === v.trim().toLowerCase());
    const next = lines.map((c): Row => {
      const emp = found.get((c[0] ?? '').trim().toUpperCase()) ?? null;
      const cat = findCat(c[2] ?? '');
      return {
        ...blank(),
        employee: emp,
        title: (c[1] ?? '').trim().slice(0, 120),
        categoryId: cat?.id ?? '',
        transactionDate: parseDate((c[3] ?? '').trim()) ?? '',
        amountInclSst: (c[4] ?? '').trim(),
        sstAmount: (c[5] ?? '').trim(),
        receiptNo: (c[6] ?? '').trim(),
        myinvoisUuid: (c[7] ?? '').trim(),
        description: (c[8] ?? '').trim(),
        distanceKm: (c[9] ?? '').trim(),
        fromPlace: (c[10] ?? '').trim(),
        toPlace: (c[11] ?? '').trim(),
        purpose: (c[12] ?? '').trim(),
        status: !emp ? { ok: false, message: `Employee ${(c[0] ?? '').trim()} not found.` } : !cat ? { ok: false, message: `Category “${(c[2] ?? '').trim()}” not found.` } : null,
      };
    });
    setRows((rs) => [...rs.filter((r) => used.includes(r)), ...next]);
    setPaste(null);
  };

  const cell = (i: number, field: keyof Row, w = 120, props: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <TextField size="small" value={rows[i]![field] as string} onChange={(e) => set(i, { [field]: e.target.value } as Partial<Row>)} sx={{ minWidth: w }} slotProps={{ htmlInput: { 'aria-label': `Row ${i + 1} ${String(field)}` } }} {...props} />
  );

  if (result) {
    return (
      <Card>
        <CardContent>
          <Typography variant="h5" component="h2" sx={{ mb: 1 }}>
            {result.created} claims created · {result.failed} failed
          </Typography>
          <MiniTable
            caption="Bulk entry result"
            rows={result.claims}
            getRowId={(r) => `${r.employee.id}-${r.claimNo ?? r.result}`}
            columns={[
              { key: 'n', header: 'Claim no.', render: (r) => (r.claimNo ? <NextLink href={`/approvals/claims/${encodeURIComponent(r.claimNo)}?from=claims`}>{r.claimNo}</NextLink> : '—') },
              { key: 'e', header: 'Employee', render: (r) => r.employee.name },
              { key: 'l', header: 'Lines', render: (r) => r.lines },
              { key: 't', header: 'Total (RM)', align: 'right', render: (r) => <MoneyCell v={r.total} /> },
              { key: 'r', header: 'Result', render: (r) => <Typography component="span" variant="body2" sx={{ color: r.ok ? '#198754' : '#B42318' }}>{r.ok ? '✓ ' : '✕ '}{r.result}</Typography> },
            ]}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
            <Button variant="contained" onClick={() => (setResult(null), setRows([blank(), blank(), blank()]), setPreview(null))}>
              Enter more
            </Button>
            <Button component={NextLink} href="/claims">
              Back to claims
            </Button>
          </Stack>
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      <Alert severity="info">Mileage rows need a receipt: {MILEAGE_RECEIPT_HINT} Rows with the same employee and claim title form one claim. Claims are created on behalf and submitted for the normal single approval — you can&apos;t approve them yourself.</Alert>
      {error && <Alert severity="error">{error}</Alert>}
      {preview && (
        <Alert severity={preview.errors ? 'warning' : 'success'}>
          {preview.claims} claims from {preview.rows.length} rows · {preview.errors} rows with errors.
        </Alert>
      )}
      <Card>
        <TableContainer sx={{ maxHeight: '65vh' }}>
          <Table size="small" stickyHeader aria-label="Bulk claim entry">
            <TableHead>
              <TableRow>
                {['#', 'Employee *', 'Claim title *', 'Category *', 'Transaction date *', 'Amount incl. SST *', 'SST', 'Receipt no.', 'UUID', 'Notes', 'Distance km', 'From', 'To', 'Purpose', 'Attachment', 'Row status', ''].map((h) => (
                  <TableCell key={h} sx={{ whiteSpace: 'nowrap' }}>
                    {h}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => {
                const mileage = Boolean(catOf(r.categoryId)?.isMileage);
                return (
                  <TableRow key={r.key}>
                    <TableCell>{i + 1}</TableCell>
                    <TableCell sx={{ minWidth: 220 }}>
                      <ClaimEmployeePicker label="Employee" size="small" value={r.employee} onChange={(p) => set(i, { employee: p })} />
                    </TableCell>
                    <TableCell>{cell(i, 'title', 180)}</TableCell>
                    <TableCell>
                      <TextField select size="small" value={r.categoryId} onChange={(e) => set(i, { categoryId: e.target.value })} sx={{ minWidth: 200 }} slotProps={{ htmlInput: { 'aria-label': `Row ${i + 1} category` } }}>
                        {categories.map((c) => (
                          <MenuItem key={c.id} value={c.id}>
                            {c.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TableCell>
                    <TableCell>{cell(i, 'transactionDate', 150, { type: 'date' })}</TableCell>
                    <TableCell>{cell(i, 'amountInclSst', 110, { disabled: mileage, placeholder: mileage ? 'km × rate' : undefined })}</TableCell>
                    <TableCell>{cell(i, 'sstAmount', 90, { disabled: mileage })}</TableCell>
                    <TableCell>{cell(i, 'receiptNo')}</TableCell>
                    <TableCell>{cell(i, 'myinvoisUuid')}</TableCell>
                    <TableCell>{cell(i, 'description', 160)}</TableCell>
                    <TableCell>{cell(i, 'distanceKm', 90, { disabled: !mileage })}</TableCell>
                    <TableCell>{cell(i, 'fromPlace', 110)}</TableCell>
                    <TableCell>{cell(i, 'toPlace', 110)}</TableCell>
                    <TableCell>{cell(i, 'purpose', 130)}</TableCell>
                    <TableCell>
                      <Tooltip title={mileage ? MILEAGE_RECEIPT_HINT : ''} disableHoverListener={!mileage}>
                      <Button component="label" size="small" startIcon={<AttachFileIcon />} disabled={!r.employee}>
                        {r.fileIds.length || 'Add'}
                        <input
                          hidden
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png,.heic"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const res = await uploadClaimFile(file, { employeeId: r.employee?.id, categoryId: r.categoryId || null });
                            if (res.ok) set(i, { fileIds: [...r.fileIds, res.fileId].slice(0, 5) });
                            else toast.info(res.error);
                            e.target.value = '';
                          }}
                        />
                      </Button>
                      </Tooltip>
                      {mileage && (
                        <Typography variant="caption" color="text.secondary" component="p" sx={{ maxWidth: 200 }}>
                          {MILEAGE_RECEIPT_HINT}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ minWidth: 160 }}>
                      {r.status && (
                        <Typography variant="body2" sx={{ color: r.status.ok ? '#198754' : '#B42318' }}>
                          {r.status.ok ? '✓' : `✕ ${r.status.message ?? ''}`}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <IconButton aria-label={`Delete row ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, n) => n !== i))}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button variant="outlined" onClick={() => setRows((rs) => [...rs, blank()])} disabled={rows.length >= 200}>
          Add row
        </Button>
        <Button variant="outlined" onClick={() => setPaste('')}>
          Paste from spreadsheet
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button variant="outlined" onClick={validate} loading={busy === 'validate'}>
          Validate
        </Button>
        <Button variant="contained" onClick={submit} loading={busy === 'submit'} disabled={!preview || preview.errors > 0 || busy !== null}>
          Submit all
        </Button>
      </Stack>
      <ResponsiveDialog
        open={paste !== null}
        onClose={() => setPaste(null)}
        title="Paste from spreadsheet"
        maxWidth="md"
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setPaste(null)}>
              Cancel
            </Button>
            <Button variant="contained" onClick={() => void applyPaste(paste ?? '')} disabled={!paste?.trim()}>
              Add rows
            </Button>
          </>
        }
      >
        <Typography variant="body2" sx={{ mb: 1 }}>
          Copy cells from a spreadsheet in this column order: Employee no. · Claim title · Category code or name · Transaction date (dd/mm/yyyy) · Amount incl. SST · SST · Receipt no. · UUID · Notes · Distance km · From · To · Purpose.
        </Typography>
        <TextField multiline minRows={8} fullWidth value={paste ?? ''} onChange={(e) => setPaste(e.target.value)} label="Pasted rows" />
      </ResponsiveDialog>
    </Stack>
  );
}
