'use client';

// E3 tab 12 · Documents (group K) + E11 · S-EM-11 Upload / edit document.
// List: Title › · Category · Document date · Expiry · Visible to employee (✓/—) · Uploaded by/at ·
// ⋮ Download (logged) · Edit metadata · Change visibility · Deactivate / Reactivate.
// Filters Category, Visible, Active · UPLOAD DOCUMENT · EXPORT .CSV (list only).
// HR-only categories (MyKad copy, Medical report, Disciplinary letter, Bank proof) show 🔒.
import * as React from 'react';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import LockIcon from '@mui/icons-material/Lock';
import {
  DEFAULT_VISIBLE_DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  HR_ONLY_DOCUMENT_CATEGORIES,
  type DocumentCategory,
  type DocumentListParams,
  type EmployeeDocumentRow,
} from '@/server/contracts/employees';
import { createDocument, exportEmployeeDocumentsCsv, getDocumentDownloadUrl, setDocumentActive, updateDocument } from '@/server/actions/employees';
import ListPage, { type ListColumn } from '../../list/ListPage';
import { KeywordField, MultiSelectFilter, SelectFilter } from '../../list/FilterFields';
import { downloadServerCsv, useServerList } from '../../list/useServerList';
import FormDialog from '../../forms/FormDialog';
import { DateInput, FormGrid, SelectInput, SwitchInput, TextInput } from '../../forms/fields';
import { useActionRunner } from '../../forms/useActionRunner';
import { useToast } from '../../ToastProvider';
import DateText from '../../DateText';
import { FileField } from '../fieldGroups';
import { DOCUMENT_ACCEPT, uploadEmployeeFile } from '../upload';
import { optionsOf } from '../labels';
import { DOCUMENT_FILTERS } from '../filters';
import { formatDate, formatDateTime } from '@/lib/format';

export async function openDocument(id: string, toast: ReturnType<typeof useToast>) {
  try {
    const res = await getDocumentDownloadUrl({ id });
    if (res.ok) window.open(res.url, '_blank', 'noopener');
    else toast.info(res.error);
  } catch {
    toast.info('Could not open the document.');
  }
}

export default function DocumentsTab({
  employeeId,
  rows,
  total,
  params,
  canUpload,
  own,
}: {
  employeeId: string;
  rows: EmployeeDocumentRow[];
  total: number;
  params: DocumentListParams;
  canUpload: boolean;
  own: boolean;
}) {
  const list = useServerList({ filters: DOCUMENT_FILTERS, sort: { key: 'uploadedAt', direction: 'desc' }, preserve: ['tab'] });
  const toast = useToast();
  const r = useActionRunner();
  const d = list.draft;
  const set = list.setDraftField;
  const [dialog, setDialog] = React.useState<EmployeeDocumentRow | 'new' | null>(null);

  const columns: ListColumn<EmployeeDocumentRow>[] = [
    {
      key: 'title',
      header: 'Title',
      value: (x) => x.title,
      render: (x) => (
        <Link component="button" type="button" onClick={() => openDocument(x.id, toast)} sx={{ textAlign: 'left' }}>
          {x.title}
          {!x.isActive && ' (inactive)'}
        </Link>
      ),
      minWidth: 180,
    },
    {
      key: 'category',
      header: 'Category',
      value: (x) => DOCUMENT_CATEGORY_LABELS[x.category],
      render: (x) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <span>{DOCUMENT_CATEGORY_LABELS[x.category]}</span>
          {x.isHrOnlyCategory && (
            <Tooltip title="Always HR-only">
              <LockIcon fontSize="inherit" aria-label="Always HR-only" sx={{ color: 'text.secondary' }} />
            </Tooltip>
          )}
        </Stack>
      ),
    },
    { key: 'documentDate', header: 'Document date', kind: 'date', value: (x) => formatDate(x.documentDate), render: (x) => <DateText value={x.documentDate} /> },
    { key: 'expiryDate', header: 'Expiry', kind: 'date', value: (x) => formatDate(x.expiryDate), render: (x) => <DateText value={x.expiryDate} /> },
    { key: 'visible', header: 'Visible to employee', sortable: false, align: 'center', value: (x) => (x.visibleToEmployee ? '✓' : '—') },
    { key: 'uploadedAt', header: 'Uploaded by / at', value: (x) => `${x.uploadedByName ?? ''} ${formatDateTime(x.uploadedAt)}`.trim(), minWidth: 170 },
  ];

  return (
    <>
      <ListPage<EmployeeDocumentRow>
        itemName={{ singular: 'document', plural: 'documents' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches the title." />,
          <MultiSelectFilter key="cat" label="Category" value={d.categories} onChange={(v) => set('categories', v)} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }))} />,
          <SelectFilter
            key="vis"
            label="Visible to employee"
            value={d.visible}
            onChange={(v) => set('visible', v)}
            options={[
              { value: 'visible', label: 'Visible' },
              { value: 'hidden', label: 'HR only' },
            ]}
          />,
          <SelectFilter
            key="act"
            label="Active"
            value={d.active}
            onChange={(v) => set('active', v)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'all', label: 'All' },
            ]}
          />,
        ]}
        {...list.listProps}
        onExport={async () => {
          try {
            const res = await exportEmployeeDocumentsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'documents', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        addNew={canUpload && !own ? { label: 'Upload document', onClick: () => setDialog('new') } : undefined}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowRef={(x) => x.title}
        rowActions={(x) => [
          { label: 'Download', onClick: () => openDocument(x.id, toast) },
          ...(canUpload
            ? [
                { label: 'Edit metadata', onClick: () => setDialog(x) },
                ...(x.isHrOnlyCategory
                  ? []
                  : [
                      {
                        label: x.visibleToEmployee ? 'Hide from employee' : 'Make visible to employee',
                        onClick: () =>
                          void r.run(
                            () =>
                              updateDocument({
                                id: x.id,
                                version: x.version,
                                category: x.category,
                                title: x.title,
                                documentDate: x.documentDate,
                                expiryDate: x.expiryDate,
                                visibleToEmployee: !x.visibleToEmployee,
                                remarks: x.remarks,
                              }),
                            { success: x.visibleToEmployee ? 'Hidden from the employee.' : 'Now visible to the employee.' },
                          ),
                      },
                    ]),
                {
                  label: x.isActive ? 'Deactivate' : 'Reactivate',
                  danger: x.isActive,
                  onClick: () => void r.run(() => setDocumentActive({ id: x.id, isActive: !x.isActive }), { success: x.isActive ? 'Document deactivated.' : 'Document reactivated.' }),
                },
              ]
            : []),
        ]}
        empty={{ title: 'No documents yet.' }}
      />
      <DocumentDialog open={dialog !== null} onClose={() => setDialog(null)} employeeId={employeeId} row={dialog === 'new' ? null : dialog} />
    </>
  );
}

function DocumentDialog({ open, onClose, employeeId, row }: { open: boolean; onClose: () => void; employeeId: string; row: EmployeeDocumentRow | null }) {
  const r = useActionRunner();
  const [file, setFile] = React.useState<File | null>(null);
  const [f, setF] = React.useState({ category: '', title: '', documentDate: '', expiryDate: '', visibleToEmployee: false, remarks: '' });
  React.useEffect(() => {
    if (!open) return;
    r.reset();
    setFile(null);
    setF({
      category: row?.category ?? '',
      title: row?.title ?? '',
      documentDate: row?.documentDate ?? '',
      expiryDate: row?.expiryDate ?? '',
      visibleToEmployee: row?.visibleToEmployee ?? false,
      remarks: row?.remarks ?? '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const hrOnly = f.category !== '' && HR_ONLY_DOCUMENT_CATEGORIES.includes(f.category as DocumentCategory);
  return (
    <FormDialog
      open={open}
      title={row ? 'Edit document' : 'Upload document'}
      onClose={onClose}
      submitLabel={row ? 'Save' : 'Upload'}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty
      onSubmit={async () => {
        if (!row && !file) {
          r.setFieldErrors({ fileId: 'Choose the file.' });
          return;
        }
        const meta = { ...f, category: f.category as DocumentCategory, visibleToEmployee: hrOnly ? false : f.visibleToEmployee };
        const res = await r.run(
          async () => {
            let fileId: string | null = null;
            if (file) {
              const up = await uploadEmployeeFile(employeeId, 'document', file);
              if (!up.ok) return { ok: false as const, error: up.error, fieldErrors: { fileId: up.error } };
              fileId = up.fileId;
            }
            return row ? updateDocument({ id: row.id, version: row.version, replaceFileId: fileId, ...meta }) : createDocument({ employeeId, fileId: fileId!, ...meta });
          },
          { success: row ? (file ? 'New version uploaded.' : 'Document saved.') : 'Document uploaded.' },
        );
        if (res?.ok) onClose();
      }}
    >
      <FormGrid>
        <SelectInput
          label="Category"
          required
          value={f.category}
          onChange={(v) => setF({ ...f, category: v, visibleToEmployee: HR_ONLY_DOCUMENT_CATEGORIES.includes(v as DocumentCategory) ? false : row ? f.visibleToEmployee : DEFAULT_VISIBLE_DOCUMENT_CATEGORIES.includes(v as DocumentCategory) })}
          options={optionsOf(DOCUMENT_CATEGORY_LABELS)}
          error={r.fieldErrors.category}
        />
        <TextInput label="Title" required value={f.title} onChange={(v) => setF({ ...f, title: v })} maxLength={100} error={r.fieldErrors.title} />
        <FileField
          label={row ? 'Replace file (new version — the old one is kept)' : 'File'}
          required={!row}
          file={file}
          onChange={setFile}
          accept={DOCUMENT_ACCEPT}
          existing={row?.file.fileName}
          error={r.fieldErrors.fileId}
          helper="PDF, JPG, PNG, HEIC or DOCX — up to 10 MB."
        />
        <DateInput label="Document date" value={f.documentDate} onChange={(v) => setF({ ...f, documentDate: v })} error={r.fieldErrors.documentDate} />
        <DateInput label="Expiry date" value={f.expiryDate} onChange={(v) => setF({ ...f, expiryDate: v })} minDate={f.documentDate || undefined} error={r.fieldErrors.expiryDate} helper="Alert 30 days before." />
        <SwitchInput
          label="Visible to employee"
          checked={hrOnly ? false : f.visibleToEmployee}
          onChange={(v) => setF({ ...f, visibleToEmployee: v })}
          locked={hrOnly ? 'This category is always HR-only.' : false}
          error={r.fieldErrors.visibleToEmployee}
        />
        <TextInput full label="Remarks" value={f.remarks} onChange={(v) => setF({ ...f, remarks: v })} maxLength={500} multiline minRows={2} error={r.fieldErrors.remarks} />
      </FormGrid>
    </FormDialog>
  );
}
