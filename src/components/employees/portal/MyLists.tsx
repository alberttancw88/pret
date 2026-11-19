'use client';

// P18 · My change requests — S-PT-18 · /my/profile/change-requests · US-EMP-017.
//   Search CR no. · Filters Status, Category, Submitted from–to · Columns CR no. › · Category ·
//   Submitted at · Effective date · Status ● · Decided at · ⋮ CANCEL REQUEST (Submitted) ·
//   NEW REQUEST · EXPORT .CSV.
// P19 · My documents — S-PT-19 · /my/documents · F-PRT-09 · US-PORTAL-009.
//   Only documents HR made visible: Search title · Filter Category · Columns Title › · Category ·
//   Document date / Expiry · Uploaded at · DOWNLOAD (logged) · EXPORT .CSV (list only).
import * as React from 'react';
import Link from '@mui/material/Link';
import {
  CR_CATEGORIES,
  CR_CATEGORY_LABELS,
  CR_STATUSES,
  CR_STATUS_LABELS,
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  type ChangeRequestListParams,
  type ChangeRequestRow,
  type MyDocumentListParams,
  type MyDocumentRow,
} from '@/server/contracts/employees';
import { cancelChangeRequest, exportMyChangeRequestsCsv, exportMyDocumentsCsv } from '@/server/actions/employees';
import ListPage, { type ListColumn } from '../../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter } from '../../list/FilterFields';
import { downloadServerCsv, useServerList } from '../../list/useServerList';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { useActionRunner } from '../../forms/useActionRunner';
import { useToast } from '../../ToastProvider';
import DateText from '../../DateText';
import { CrStatusChip } from '../labels';
import { MY_CR_FILTERS, MY_DOCUMENT_FILTERS } from '../filters';
import { openDocument } from '../profile/DocumentsTab';
import { formatDate, formatDateTime } from '@/lib/format';

export function MyChangeRequestsList({ rows, total, params }: { rows: ChangeRequestRow[]; total: number; params: ChangeRequestListParams }) {
  const list = useServerList({ filters: MY_CR_FILTERS, sort: { key: 'submittedAt', direction: 'desc' } });
  const toast = useToast();
  const r = useActionRunner();
  const d = list.draft;
  const set = list.setDraftField;
  const [cancel, setCancel] = React.useState<ChangeRequestRow | null>(null);
  const columns: ListColumn<ChangeRequestRow>[] = [
    { key: 'crNo', header: 'CR no.', value: (x) => x.crNo },
    { key: 'category', header: 'Category', value: (x) => CR_CATEGORY_LABELS[x.category] },
    { key: 'submittedAt', header: 'Submitted at', kind: 'date', value: (x) => formatDateTime(x.submittedAt), render: (x) => <DateText value={x.submittedAt} mode="datetime" /> },
    { key: 'effectiveDate', header: 'Effective date', kind: 'date', value: (x) => formatDate(x.effectiveDate), render: (x) => <DateText value={x.effectiveDate} /> },
    { key: 'status', header: 'Status', kind: 'status', value: (x) => CR_STATUS_LABELS[x.status], render: (x) => <CrStatusChip status={x.status} /> },
    { key: 'decidedAt', header: 'Decided at', kind: 'date', sortable: false, value: (x) => formatDateTime(x.decidedAt), render: (x) => <DateText value={x.decidedAt} mode="datetime" /> },
  ];
  return (
    <>
      <ListPage<ChangeRequestRow>
        itemName={{ singular: 'change request', plural: 'change requests' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches the CR no." />,
          <MultiSelectFilter key="s" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={CR_STATUSES.map((s) => ({ value: s, label: CR_STATUS_LABELS[s] }))} />,
          <MultiSelectFilter key="c" label="Category" value={d.categories} onChange={(v) => set('categories', v)} options={CR_CATEGORIES.map((s) => ({ value: s, label: CR_CATEGORY_LABELS[s] }))} />,
          <DateFilter key="f" label="Submitted from" value={d.submittedFrom} onChange={(v) => set('submittedFrom', v)} />,
          <DateFilter key="t" label="Submitted to" value={d.submittedTo} onChange={(v) => set('submittedTo', v)} />,
        ]}
        {...list.listProps}
        onExport={async () => {
          try {
            const res = await exportMyChangeRequestsCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'my-change-requests', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        addNew={{ label: 'New request', href: '/my/profile/change-requests/new' }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(x) => x.id}
        getRowHref={(x) => `/my/profile/change-requests/${encodeURIComponent(x.crNo)}`}
        getRowRef={(x) => x.crNo}
        rowActions={(x) => (x.status === 'submitted' ? [{ label: 'Cancel request', danger: true, onClick: () => setCancel(x) }] : [])}
        empty={{ title: 'No change requests yet.', helper: 'Use NEW REQUEST to ask HR to change your legal name, MyKad, family, bank or statutory details.' }}
      />
      <ConfirmDialog
        open={cancel !== null}
        title={`Cancel ${cancel?.crNo ?? ''}?`}
        body="HR will no longer review this request."
        confirmLabel="Cancel request"
        cancelLabel="Keep request"
        destructive
        onClose={() => setCancel(null)}
        onConfirm={async () => {
          if (cancel) {
            const res = await r.run(() => cancelChangeRequest({ id: cancel.id }), { success: `${cancel.crNo} cancelled.` });
            if (res && !res.ok) toast.info(res.error);
          }
          setCancel(null);
        }}
      />
    </>
  );
}

export function MyDocumentsList({ rows, total, params }: { rows: MyDocumentRow[]; total: number; params: MyDocumentListParams }) {
  const list = useServerList({ filters: MY_DOCUMENT_FILTERS, sort: { key: 'uploadedAt', direction: 'desc' } });
  const toast = useToast();
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<MyDocumentRow>[] = [
    {
      key: 'title',
      header: 'Title',
      value: (x) => x.title,
      render: (x) => (
        <Link component="button" type="button" onClick={() => openDocument(x.id, toast)} sx={{ textAlign: 'left' }}>
          {x.title}
        </Link>
      ),
    },
    { key: 'category', header: 'Category', value: (x) => DOCUMENT_CATEGORY_LABELS[x.category] },
    { key: 'documentDate', header: 'Document date', kind: 'date', value: (x) => formatDate(x.documentDate), render: (x) => <DateText value={x.documentDate} /> },
    { key: 'expiry', header: 'Expiry', kind: 'date', sortable: false, value: (x) => formatDate(x.expiryDate), render: (x) => <DateText value={x.expiryDate} /> },
    { key: 'uploadedAt', header: 'Uploaded at', kind: 'date', value: (x) => formatDate(x.uploadedAt), render: (x) => <DateText value={x.uploadedAt} /> },
  ];
  return (
    <ListPage<MyDocumentRow>
      itemName={{ singular: 'document', plural: 'documents' }}
      filters={[
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches the title." />,
        <MultiSelectFilter key="c" label="Category" value={d.categories} onChange={(v) => set('categories', v)} options={DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: DOCUMENT_CATEGORY_LABELS[c] }))} />,
      ]}
      {...list.listProps}
      onExport={async () => {
        try {
          const res = await exportMyDocumentsCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'my-documents', res.content);
          else toast.info(res.error);
        } catch {
          toast.info('Export failed. Please try again.');
        }
      }}
      columns={columns}
      rows={rows}
      total={total}
      getRowId={(x) => x.id}
      getRowRef={(x) => x.title}
      rowActions={(x) => [{ label: 'Download', onClick: () => openDocument(x.id, toast) }]}
      empty={{ title: "HR hasn't shared any documents with you." }}
    />
  );
}
