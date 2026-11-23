'use client';

// G5 · S-GL-07 · /notifications · F-PRT-13, F-NTF-02 · US-PORTAL-013 — own notifications only.
// Filters: Read status (All / Unread / Read) · Category · Received from–to · search (title, summary).
// Columns: Status dot · Title (link → deep link, marks read) · Summary · Category · Received (dd/mm/yyyy HH:mm).
// Actions: MARK ALL READ · EXPORT .CSV (own, filtered set) · CLEAR · SEARCH; row ⋮ Mark read / Mark unread.
// Pagination 25, newest first. Empty: "You're all caught up."
import * as React from 'react';
import { useRouter } from 'next/navigation';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationListParams,
  type NotificationRow,
} from '@/server/contracts/portal';
import { exportNotificationsCsv, markAllNotificationsRead, markNotification, openNotification } from '@/server/actions/portal';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import DateText from '../DateText';
import { useToast } from '../ToastProvider';
import { formatDateTime } from '@/lib/format';
import { announceUnreadCount } from '../shell/AppShell';

export const NOTIFICATION_FILTERS = { q: '', read: 'all', categories: '', dateFrom: '', dateTo: '' };

function Dot({ unread }: { unread: boolean }) {
  return (
    <Box
      component="span"
      role="img"
      aria-label={unread ? 'Unread' : 'Read'}
      sx={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        bgcolor: unread ? 'primary.main' : 'transparent',
        border: unread ? 'none' : '1px solid',
        borderColor: 'grey.500',
      }}
    />
  );
}

export default function NotificationsList({ rows, total, params }: { rows: NotificationRow[]; total: number; params: NotificationListParams }) {
  const list = useServerList({ filters: NOTIFICATION_FILTERS, rowsPerPage: 25, sort: { key: 'createdAt', direction: 'desc' } });
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const d = list.draft;
  const set = list.setDraftField;

  const open = async (n: NotificationRow) => {
    let href = n.href;
    try {
      const res = await openNotification({ id: n.id });
      if (res.ok) {
        href = res.href ?? href;
        announceUnreadCount(res.unreadCount);
      }
    } catch {
      /* follow the link anyway */
    }
    if (href && href.startsWith('/') && !href.startsWith('//')) router.push(href);
    else router.refresh();
  };

  const mark = async (n: NotificationRow, read: boolean) => {
    try {
      const res = await markNotification({ id: n.id, read });
      if (res.ok) {
        announceUnreadCount(res.unreadCount);
        router.refresh();
      } else toast.info(res.error);
    } catch {
      toast.info('Something went wrong. Please try again.');
    }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      const res = await markAllNotificationsRead();
      if (res.ok) {
        announceUnreadCount(0);
        toast.success(res.marked === 1 ? '1 notification marked as read.' : `${res.marked} notifications marked as read.`);
        router.refresh();
      } else toast.info(res.error);
    } catch {
      toast.info('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const columns: ListColumn<NotificationRow>[] = [
    {
      key: 'title',
      header: 'Title',
      sortable: false,
      value: (n) => n.title,
      render: (n) => (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 1 }}>
          <Dot unread={n.unread} />
          <Link component="button" type="button" onClick={() => void open(n)} sx={{ textAlign: 'left', fontWeight: n.unread ? 700 : 500, minHeight: 24 }}>
            {n.title}
          </Link>
        </Box>
      ),
    },
    {
      key: 'summary',
      header: 'Summary',
      sortable: false,
      value: (n) => n.summary ?? '',
      render: (n) => (
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
          {n.summary ?? '—'}
        </Typography>
      ),
    },
    { key: 'category', header: 'Category', sortable: false, value: (n) => NOTIFICATION_CATEGORY_LABELS[n.category] },
    {
      key: 'createdAt',
      header: 'Received',
      kind: 'date',
      value: (n) => formatDateTime(n.createdAt),
      render: (n) => <DateText value={n.createdAt} mode="datetime" />,
    },
  ];

  const hasUnread = rows.some((n) => n.unread) || params.read === 'unread';

  return (
    <ListPage<NotificationRow>
      itemName={{ singular: 'notification', plural: 'notifications' }}
      filters={[
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches title and summary." />,
        <SelectFilter
          key="read"
          label="Read status"
          value={d.read === 'all' ? '' : d.read}
          onChange={(v) => set('read', v || 'all')}
          options={[
            { value: 'unread', label: 'Unread' },
            { value: 'read', label: 'Read' },
          ]}
        />,
        <MultiSelectFilter
          key="categories"
          label="Category"
          value={d.categories}
          onChange={(v) => set('categories', v)}
          options={NOTIFICATION_CATEGORIES.map((c) => ({ value: c, label: NOTIFICATION_CATEGORY_LABELS[c] + (c === 'payroll' ? ' (R1.1)' : '') }))}
        />,
        <DateFilter key="from" label="Received from" value={d.dateFrom} onChange={(v) => set('dateFrom', v)} />,
        <DateFilter key="to" label="Received to" value={d.dateTo} onChange={(v) => set('dateTo', v)} />,
      ]}
      {...list.listProps}
      onExport={async () => {
        try {
          const res = await exportNotificationsCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'notifications', res.content);
          else toast.info(res.error);
        } catch {
          toast.info('Export failed. Please try again.');
        }
      }}
      extraActions={
        <Button variant="outlined" color="inherit" startIcon={<DoneAllIcon />} onClick={markAll} loading={busy} disabled={!hasUnread}>
          Mark all read
        </Button>
      }
      columns={columns}
      rows={rows}
      total={total}
      getRowId={(n) => n.id}
      getRowRef={(n) => n.title}
      rowActions={(n) => [n.unread ? { label: 'Mark read', onClick: () => void mark(n, true) } : { label: 'Mark unread', onClick: () => void mark(n, false) }]}
      empty={{ title: "You're all caught up." }}
    />
  );
}
