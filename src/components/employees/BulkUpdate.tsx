'use client';

// E14 · Bulk update via CSV — S-EM-14 · /employees/bulk-update · F-EMP-25 · US-EMP-022.
// Step 1: DOWNLOAD TEMPLATE (employee no. + chosen columns) · Fields to update * · Effective
// date * (creates job-history rows) · Upload file * · Remarks. Step 2 Preview: rows · valid ·
// errors · warnings; table Row · Employee no. · Field · Current · New · Result (✓ / ✕ message);
// DOWNLOAD ERROR REPORT. Step 3: COMMIT {n} CHANGES (only when 0 errors; all or none) → summary.
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import {
  BULK_MAX_CSV_BYTES,
  BULK_UPDATE_FIELDS,
  BULK_UPDATE_FIELD_LABELS,
  BULK_UPDATE_HEADERS,
  type BulkUpdateCommitResult,
  type BulkUpdateField,
  type BulkUpdatePreview,
} from '@/server/contracts/employees';
import { commitBulkUpdate, downloadBulkUpdateTemplate, exportBulkUpdateErrorsCsv, previewBulkUpdate } from '@/server/actions/employees';
import ErrorSummary from '../forms/ErrorSummary';
import { DateInput, FormGrid, MultiSelectInput, TextInput } from '../forms/fields';
import { downloadServerCsv } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import { FileField } from './fieldGroups';
import { KVGrid, MiniTable } from './ui';
import { formatDate, todayMyt } from '@/lib/format';

const RESULT_TEXT = { ok: '✓ Change', unchanged: '— No change', warning: '⚠ Warning', error: '✕ Error' } as const;

export default function BulkUpdate() {
  const toast = useToast();
  const [step, setStep] = React.useState(0);
  const [fields, setFields] = React.useState<BulkUpdateField[]>([]);
  const [effectiveDate, setEffectiveDate] = React.useState(todayMyt());
  const [file, setFile] = React.useState<File | null>(null);
  const [csv, setCsv] = React.useState('');
  const [remarks, setRemarks] = React.useState('');
  const [busy, setBusy] = React.useState<'template' | 'preview' | 'errors' | 'commit' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<BulkUpdatePreview | null>(null);
  const [result, setResult] = React.useState<BulkUpdateCommitResult | null>(null);

  const input = () => ({ fields, effectiveDate, csv, remarks });
  const onFile = async (f: File | null) => {
    setFile(f);
    setCsv('');
    setPreview(null);
    if (!f) return;
    if (f.size > BULK_MAX_CSV_BYTES) {
      setFieldErrors({ csv: 'The file must be 1 MB or smaller.' });
      return;
    }
    if (!/\.csv$/i.test(f.name)) {
      setFieldErrors({ csv: 'Upload a .csv file (use the template).' });
      return;
    }
    setFieldErrors({});
    setCsv(await f.text());
  };
  const template = async () => {
    if (!fields.length) {
      setFieldErrors({ fields: 'Select the fields to update.' });
      return;
    }
    setBusy('template');
    try {
      const res = await downloadBulkUpdateTemplate({ fields });
      if (res.ok) downloadServerCsv(res.filename || 'bulk-update-template', res.content);
      else toast.info(res.error);
    } finally {
      setBusy(null);
    }
  };
  const runPreview = async () => {
    const fe: Record<string, string> = {};
    if (!fields.length) fe.fields = 'Select the fields to update.';
    if (!effectiveDate) fe.effectiveDate = 'Enter the effective date.';
    if (!csv) fe.csv = 'Upload the CSV file.';
    setFieldErrors(fe);
    if (Object.keys(fe).length) return;
    setBusy('preview');
    setError(null);
    try {
      const res = await previewBulkUpdate(input());
      if (res.ok) {
        setPreview(res);
        setStep(1);
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
      }
    } catch {
      setError('Validation failed. Please try again.');
    } finally {
      setBusy(null);
    }
  };
  const errorsCsv = async () => {
    setBusy('errors');
    try {
      const res = await exportBulkUpdateErrorsCsv(input());
      if (res.ok) downloadServerCsv(res.filename || 'bulk-update-errors', res.content);
      else toast.info(res.error);
    } finally {
      setBusy(null);
    }
  };
  const commit = async () => {
    setBusy('commit');
    setError(null);
    try {
      const res = await commitBulkUpdate(input());
      if (res.ok) {
        setResult(res);
        setStep(2);
        toast.success(`${res.employeesChanged} employees updated.`);
      } else setError(res.error);
    } catch {
      setError('Commit failed. Nothing was changed.');
    } finally {
      setBusy(null);
    }
  };
  const reset = () => {
    setStep(0);
    setFile(null);
    setCsv('');
    setPreview(null);
    setResult(null);
    setError(null);
  };

  return (
    <Stack spacing={2}>
      <Card>
        <CardContent>
          <Stepper activeStep={step} alternativeLabel>
            {['Upload', 'Preview', 'Done'].map((l) => (
              <Step key={l}>
                <StepLabel>{l}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </CardContent>
      </Card>
      <ErrorSummary error={error} fieldErrors={fieldErrors} labels={{ fields: 'Fields to update', effectiveDate: 'Effective date', csv: 'File' }} />
      {step === 0 && (
        <Card>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <FormGrid>
              <MultiSelectInput
                label="Fields to update"
                required
                value={fields}
                onChange={(v) => setFields(v as BulkUpdateField[])}
                options={BULK_UPDATE_FIELDS.map((f) => ({ value: f, label: BULK_UPDATE_FIELD_LABELS[f] }))}
                error={fieldErrors.fields}
              />
              <DateInput label="Effective date" required value={effectiveDate} onChange={setEffectiveDate} error={fieldErrors.effectiveDate} helper="Creates job-history rows from this date (future = Scheduled)." />
              <Box>
                <Button variant="outlined" startIcon={<FileDownloadOutlinedIcon />} onClick={template} loading={busy === 'template'}>
                  Download template
                </Button>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                  Columns: Employee no.{fields.map((f) => ` · ${BULK_UPDATE_HEADERS[f]}`).join('')}
                </Typography>
              </Box>
              <FileField label="Upload file" required file={file} onChange={onFile} accept=".csv" error={fieldErrors.csv} helper="CSV from the template, up to 1 MB." />
              <TextInput full label="Remarks" value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={2} />
            </FormGrid>
            <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
              <Button variant="outlined" color="inherit" component={NextLink} href="/employees">
                Cancel
              </Button>
              <Button variant="contained" onClick={runPreview} loading={busy === 'preview'}>
                Preview
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
      {step === 1 && preview && (
        <Card>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <KVGrid
              columns={4}
              items={[
                { label: 'Rows', value: preview.totalRows },
                { label: 'Valid', value: preview.valid },
                { label: 'Errors', value: preview.errors },
                { label: 'Warnings', value: preview.warnings },
              ]}
            />
            {preview.errors > 0 ? (
              <Alert severity="error" sx={{ my: 2 }}>
                Fix the {preview.errors} error{preview.errors === 1 ? '' : 's'} in the file and upload it again — nothing is changed until there are no errors.
              </Alert>
            ) : (
              <Alert severity="success" sx={{ my: 2 }}>
                Ready: {preview.changes} change{preview.changes === 1 ? '' : 's'} effective {formatDate(effectiveDate)}. All or none are applied.
              </Alert>
            )}
            <MiniTable
              caption="Preview"
              rows={preview.rows}
              getRowId={(x) => `${x.rowNo}-${x.field ?? ''}-${x.employeeNo}`}
              columns={[
                { key: 'r', header: 'Row', render: (x) => x.rowNo },
                { key: 'e', header: 'Employee no.', render: (x) => `${x.employeeNo}${x.employeeName ? ` · ${x.employeeName}` : ''}` },
                { key: 'f', header: 'Field', render: (x) => (x.field ? BULK_UPDATE_FIELD_LABELS[x.field] : '—') },
                { key: 'c', header: 'Current', render: (x) => x.current ?? '—' },
                { key: 'n', header: 'New', render: (x) => x.requested ?? '—' },
                { key: 's', header: 'Result', render: (x) => `${RESULT_TEXT[x.result]}${x.message ? ` — ${x.message}` : ''}` },
              ]}
            />
            <Stack direction="row" justifyContent="flex-end" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 2 }}>
              <Button variant="outlined" color="inherit" onClick={reset}>
                Start again
              </Button>
              {preview.errors > 0 && (
                <Button variant="outlined" startIcon={<FileDownloadOutlinedIcon />} onClick={errorsCsv} loading={busy === 'errors'}>
                  Download error report
                </Button>
              )}
              <Button variant="contained" onClick={commit} loading={busy === 'commit'} disabled={preview.errors > 0 || preview.changes === 0}>
                Commit {preview.changes} change{preview.changes === 1 ? '' : 's'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
      {step === 2 && result && (
        <Card>
          <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography variant="h5" component="h2" sx={{ mb: 2 }}>
              Bulk update complete
            </Typography>
            <KVGrid
              items={[
                { label: 'Employees changed', value: result.employeesChanged },
                { label: 'Job-history rows created', value: result.jobRowsCreated },
                { label: 'Group membership changes', value: result.groupChanges },
              ]}
            />
            <Stack direction="row" justifyContent="flex-end" spacing={1} sx={{ mt: 2 }}>
              <Button variant="outlined" onClick={reset}>
                Another update
              </Button>
              <Button variant="contained" component={NextLink} href="/employees">
                Employee list
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}
    </Stack>
  );
}
