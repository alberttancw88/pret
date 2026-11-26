'use client';

// A15 · Notification log — S-AC-12 · /notifications/log · F-NTF-07 · US-NOTIF-008 (ADM, SA).
// Search: recipient, reference · Filters: Event (N-xx, multi) · Channel (Email / In-app) · Delivery status · Date from–to.
// Columns: Sent at · Event · Recipient (name + email — this screen is ADM/SA only) · Channel · Delivery status ● (attempts,
// reason) · Link (reference ›) · Content summary (no personal data, BR-NTF-02). EXPORT .CSV (server-built, logged).
// Delivery banner: whether email is configured / restricted, queue counts (never fails the user's action — ADR-0010).
// Row action RETRY (Failed emails). SA: SEND QUEUED NOW (runs the dispatcher once).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  DELIVERY_STATUS_TONES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_EVENTS,
  type EmailDeliveryStatus,
  type NotificationLogParams,
  type NotificationLogRow,
} from '@/server/contracts/notifications';
import { exportNotificationLogCsv, retryEmail, sendQueuedEmailsNow } from '@/server/actions/notifications';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import { ToneChip } from '../portal/common';
import { formatDateTime } from '@/lib/format';
import { NOTIFICATION_LOG_FILTERS } from './filters';

const EVENT_OPTIONS = NOTIFICATION_EVENTS.filter((e) => e.release === 'R1.0').map((e) => ({ value: e.code, label: `${e.code} · ${e.name}` }));
const CHANNEL_OPTIONS = NOTIFICATION_CHANNELS.map((c) => ({ value: c, label: NOTIFICATION_CHANNEL_LABELS[c] }));
const STATUS_OPTIONS = DELIVERY_STATUSES.map((s) => ({ value: s, label: DELIVERY_STATUS_LABELS[s] }));

export function DeliveryBanner({ delivery, canSendNow, preview }: { delivery: EmailDeliveryStatus; canSendNow: boolean; preview?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const severity = !delivery.configured ? 'warning' : delivery.failed > 0 ? 'error' : delivery.mode === 'restricted' ? 'info' : 'success';
  const title = !delivery.configured
    ? 'Email is not configured'
    : delivery.mode === 'restricted'
      ? 'Email delivery is restricted (testing)'
      : 'Email delivery is live';
  return (
    <Alert
      severity={severity}
      action={
        canSendNow && delivery.configured ? (
          <Button
            color="inherit"
            size="small"
            startIcon={<SendOutlinedIcon />}
            loading={busy}
            loadingPosition="start"
            onClick={async () => {
              if (preview) return;
              setBusy(true);
              try {
                const r = await sendQueuedEmailsNow();
                if (r.ok) {
                  toast.success(r.skipped ? r.skipped : `Sent ${r.sent} · failed ${r.failed} · suppressed ${r.suppressed}.`);
                  router.refresh();
                } else toast.info(r.error);
              } finally {
                setBusy(false);
              }
            }}
          >
            Send queued now
          </Button>
        ) : undefined
      }
    >
      <AlertTitle>{title}</AlertTitle>
      <Typography variant="body2">{delivery.message}</Typography>
      <Typography variant="body2" className="pret-tnum" sx={{ mt: 0.5 }}>
        Queued {delivery.queued} · Retrying {delivery.retrying} · Failed {delivery.failed} · Sent in the last 24 h {delivery.sentLast24h}
        {delivery.oldestQueuedAt ? ` · Oldest queued ${formatDateTime(delivery.oldestQueuedAt)}` : ''}
        {delivery.lastSentAt ? ` · Last sent ${formatDateTime(delivery.lastSentAt)}` : ''}
      </Typography>
      {delivery.mode === 'restricted' && (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Only addresses on {delivery.allowedDomains.length ? delivery.allowedDomains.join(', ') : 'the allowed domains'} or the test-recipient list are emailed; others are
          Suppressed.
        </Typography>
      )}
    </Alert>
  );
}

export default function NotificationLog({
  rows,
  total,
  params,
  delivery,
  canSendNow,
}: {
  rows: NotificationLogRow[];
  total: number;
  params: NotificationLogParams;
  delivery: EmailDeliveryStatus;
  canSendNow: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const list = useServerList({ filters: NOTIFICATION_LOG_FILTERS, sort: { key: 'at', direction: 'desc' } });
  const d = list.draft;
  const set = list.setDraftField;

  const columns: ListColumn<NotificationLogRow>[] = [
    { key: 'at', header: 'Sent at', kind: 'date', value: (r) => formatDateTime(r.at) },
    {
      key: 'event',
      header: 'Event',
      minWidth: 180,
      value: (r) => (r.eventCode ? `${r.eventCode} · ${r.eventName ?? ''}` : r.templateCode ?? ''),
    },
    {
      key: 'recipient',
      header: 'Recipient',
      minWidth: 180,
      value: (r) => [r.recipientName, r.recipientEmail].filter(Boolean).join(' · '),
      render: (r) => (
        <Stack spacing={0}>
          <span>{r.recipientName ?? '—'}</span>
          {r.recipientEmail && (
            <Typography variant="caption" color="text.secondary">
              {r.recipientEmail}
            </Typography>
          )}
        </Stack>
      ),
    },
    { key: 'channel', header: 'Channel', sortable: false, value: (r) => NOTIFICATION_CHANNEL_LABELS[r.channel] },
    {
      key: 'status',
      header: 'Delivery status',
      kind: 'status',
      value: (r) => DELIVERY_STATUS_LABELS[r.status],
      render: (r) => (
        <Stack spacing={0.25} alignItems="flex-start">
          <ToneChip label={DELIVERY_STATUS_LABELS[r.status]} tone={DELIVERY_STATUS_TONES[r.status]} />
          {(r.channel === 'email' && r.attempts > 0) || r.statusDetail ? (
            <Typography variant="caption" color="text.secondary">
              {r.channel === 'email' && r.attempts > 0 ? `${r.attempts} attempt${r.attempts === 1 ? '' : 's'}` : ''}
              {r.channel === 'email' && r.attempts > 0 && r.statusDetail ? ' · ' : ''}
              {r.statusDetail ?? ''}
            </Typography>
          ) : null}
        </Stack>
      ),
    },
    {
      key: 'link',
      header: 'Link',
      sortable: false,
      value: (r) => r.link ?? '',
      render: (r) =>
        r.link ? (
          <Link component={NextLink} href={r.link}>
            Open ›
          </Link>
        ) : (
          '—'
        ),
    },
    { key: 'summary', header: 'Content summary', sortable: false, priority: 'low', minWidth: 220, value: (r) => r.summary },
  ];

  return (
    <Stack spacing={2}>
      <DeliveryBanner delivery={delivery} canSendNow={canSendNow} />
      <ListPage<NotificationLogRow>
        itemName={{ singular: 'notification', plural: 'notifications' }}
        filters={[
          <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Recipient, reference or subject." />,
          <MultiSelectFilter key="e" label="Event" value={d.eventCodes} onChange={(v) => set('eventCodes', v)} options={EVENT_OPTIONS} />,
          <MultiSelectFilter key="c" label="Channel" value={d.channels} onChange={(v) => set('channels', v)} options={CHANNEL_OPTIONS} />,
          <MultiSelectFilter key="s" label="Delivery status" value={d.statuses} onChange={(v) => set('statuses', v)} options={STATUS_OPTIONS} />,
          <DateFilter key="f" label="Date from" value={d.from} onChange={(v) => set('from', v)} />,
          <DateFilter key="t" label="Date to" value={d.to} onChange={(v) => set('to', v)} />,
        ]}
        {...list.listProps}
        onExport={async () => {
          const res = await exportNotificationLogCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'notification-log', res.content);
          else toast.info(res.error);
        }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => `${r.channel}-${r.id}`}
        getRowRef={(r) => r.summary}
        rowActions={(r) =>
          r.canRetry
            ? [
                {
                  label: 'Retry',
                  onClick: async () => {
                    const res = await retryEmail({ id: r.id });
                    if (res.ok) {
                      toast.success('Email queued again.');
                      router.refresh();
                    } else toast.info(res.error);
                  },
                },
              ]
            : []
        }
        empty={{ title: 'No notifications yet.' }}
      />
    </Stack>
  );
}
