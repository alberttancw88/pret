'use client';

// A16 · Notification templates — S-AC-13 · /notifications/templates · F-NTF-05 · US-NOTIF-010.
// List: Event id · Event · Recipients · Email ✓ · In-app ✓ · Action-required (✓ = cannot be opted out) · Editable ·
// Changed (overridden, by/at) · VIEW. Search (event id / name), filter "Changed only", pagination and EXPORT .CSV
// (the list is small and fully loaded, so the CSV is built from the loaded rows — no personal data in it).
// ADM: read-only. SA: edit subject / body on the detail page (Could, built).
import * as React from 'react';
import Stack from '@mui/material/Stack';
import type { NotificationTemplateRow } from '@/server/contracts/notifications';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField, YesNoFilter } from '../list/FilterFields';
import { downloadRowsAsCsv, useServerList } from '../list/useServerList';
import { ToneChip } from '../portal/common';
import { formatDateTime } from '@/lib/format';
import { TEMPLATE_FILTERS } from './filters';

const tick = (b: boolean) => (b ? '✓' : '—');

export default function NotificationTemplates({ rows }: { rows: NotificationTemplateRow[] }) {
  const list = useServerList({ filters: TEMPLATE_FILTERS, sort: { key: 'event', direction: 'asc' } });
  const d = list.draft;
  const { page, rowsPerPage, sort } = list.applied;

  const columns: ListColumn<NotificationTemplateRow>[] = [
    { key: 'event', header: 'Event id', value: (r) => r.eventCode },
    { key: 'name', header: 'Event', minWidth: 220, value: (r) => r.eventName },
    { key: 'recipients', header: 'Recipients', sortable: false, priority: 'low', minWidth: 180, value: (r) => r.recipients },
    { key: 'email', header: 'Email', align: 'center', sortable: false, value: (r) => tick(r.email) },
    { key: 'inApp', header: 'In-app', align: 'center', sortable: false, value: (r) => tick(r.inApp) },
    { key: 'mandatory', header: 'Action-required', align: 'center', sortable: false, value: (r) => tick(r.mandatory) },
    { key: 'editable', header: 'Editable', align: 'center', sortable: false, value: (r) => tick(r.editable) },
    {
      key: 'changed',
      header: 'Changed',
      kind: 'status',
      sortable: false,
      value: (r) => (r.overridden ? `Changed${r.updatedAt ? ` ${formatDateTime(r.updatedAt)}` : ''}${r.updatedByName ? ` by ${r.updatedByName}` : ''}` : 'Default'),
      render: (r) =>
        r.overridden ? (
          <Stack spacing={0.25} alignItems="flex-start">
            <ToneChip label="Changed" tone="info" />
            {r.updatedAt && (
              <span style={{ fontSize: 12.5 }}>
                {formatDateTime(r.updatedAt)}
                {r.updatedByName ? ` · ${r.updatedByName}` : ''}
              </span>
            )}
          </Stack>
        ) : (
          <ToneChip label="Default" tone="grey" outlined />
        ),
    },
  ];

  // Client-side search / filter / sort / paging over the fully loaded list (≈ 50 events).
  const q = (list.applied.filters.q ?? '').trim().toLowerCase();
  const changedOnly = list.applied.filters.overriddenOnly === 'yes';
  const unchangedOnly = list.applied.filters.overriddenOnly === 'no';
  let filtered = rows.filter(
    (r) =>
      (!q || r.eventCode.toLowerCase().includes(q) || r.eventName.toLowerCase().includes(q) || r.templateCode.includes(q)) &&
      (!changedOnly || r.overridden) &&
      (!unchangedOnly || !r.overridden),
  );
  if (sort) {
    const key = sort.key === 'name' ? 'eventName' : 'eventCode';
    filtered = [...filtered].sort((a, b) => a[key].localeCompare(b[key], 'en', { numeric: true }) * (sort.direction === 'desc' ? -1 : 1));
  }
  const pageRows = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <ListPage<NotificationTemplateRow>
      itemName={{ singular: 'template', plural: 'templates' }}
      filters={[
        <KeywordField key="q" value={d.q} onChange={(v) => list.setDraftField('q', v)} hint="Event id or name." />,
        <YesNoFilter key="o" label="Changed from default" value={d.overriddenOnly} onChange={(v) => list.setDraftField('overriddenOnly', v)} />,
      ]}
      {...list.listProps}
      onExport={() => downloadRowsAsCsv('notification-templates', columns, filtered)}
      columns={columns}
      rows={pageRows}
      total={filtered.length}
      getRowId={(r) => r.templateCode}
      getRowRef={(r) => r.eventCode}
      getRowHref={(r) => `/notifications/templates/${encodeURIComponent(r.templateCode)}`}
      empty={{ title: 'No notification templates.' }}
    />
  );
}
