'use client';

// G5 · S-GL-06 Notification panel — bell drop-down, max 10 latest; bottom sheet on phone.
// ● unread / ○ read · title · "2 h ago" · PDPA-safe summary · [Mark all read] · [View all notifications].
// Tapping a notification marks it read (openNotification) and follows its deep link.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import Drawer from '@mui/material/Drawer';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import NotificationsNoneOutlinedIcon from '@mui/icons-material/NotificationsNoneOutlined';

export type ShellNotification = {
  id: string;
  title: string;
  summary?: string | null;
  /** Deep link (relative); null when the event has none. */
  href: string | null;
  /** Pre-formatted relative time, e.g. "2 h ago". */
  when: string;
  unread: boolean;
};

export type NotificationPanelProps = {
  anchorEl: HTMLElement | null;
  onClose: () => void;
  items: ShellNotification[];
  phone: boolean;
  onMarkAllRead?: () => void;
  /** Mark read + navigate; the shell owns the server call. */
  onOpen?: (item: ShellNotification) => void;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

export default function NotificationPanel({ anchorEl, onClose, items, phone, onMarkAllRead, onOpen, loading, error, onRetry }: NotificationPanelProps) {
  const open = Boolean(anchorEl);
  const latest = items.slice(0, 10);
  const titleId = React.useId();

  const body = (
    <Box role="dialog" aria-labelledby={titleId} sx={{ width: phone ? '100%' : 380, position: 'relative' }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1 }}>
        <Typography id={titleId} variant="h6" component="h2">
          Notifications
        </Typography>
        {latest.some((n) => n.unread) && onMarkAllRead && (
          <Button variant="text" size="small" onClick={onMarkAllRead} sx={{ textTransform: 'none', minHeight: 44 }}>
            Mark all read
          </Button>
        )}
      </Stack>
      {loading ? <LinearProgress aria-label="Loading notifications" /> : <Divider />}
      {error ? (
        <Box sx={{ p: 2 }}>
          <ErrorState kind="tile" message={error} onRetry={onRetry} />
        </Box>
      ) : latest.length === 0 ? (
        <EmptyState title="You're all caught up." icon={NotificationsNoneOutlinedIcon} minHeight={160} />
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, maxHeight: phone ? '60dvh' : 420, overflowY: 'auto' }}>
          {latest.map((n) => (
            <li key={n.id}>
              <ButtonBase
                onClick={() => onOpen?.(n)}
                sx={{
                  display: 'flex',
                  width: '100%',
                  textAlign: 'left',
                  alignItems: 'flex-start',
                  gap: 1.5,
                  px: 2,
                  py: 1.25,
                  minHeight: 64,
                  color: 'text.primary',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    mt: 0.75,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    bgcolor: n.unread ? '#5A5FF2' : 'transparent',
                    border: n.unread ? 'none' : '1px solid #8F95A3',
                  }}
                />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" justifyContent="space-between" spacing={1}>
                    <Typography variant="body2" fontWeight={n.unread ? 600 : 400} sx={{ overflowWrap: 'anywhere' }}>
                      {n.unread && <Box component="span" sx={visuallyHidden}>Unread: </Box>}
                      {n.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {n.when}
                    </Typography>
                  </Stack>
                  {n.summary && (
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ overflowWrap: 'anywhere' }}>
                      {n.summary}
                    </Typography>
                  )}
                </Box>
              </ButtonBase>
            </li>
          ))}
        </Box>
      )}
      <Box sx={{ px: 2, py: 1, pb: phone ? 'calc(8px + env(safe-area-inset-bottom))' : 1 }}>
        <Link
          component={NextLink}
          href="/notifications"
          onClick={onClose}
          variant="body2"
          sx={{ display: 'inline-flex', alignItems: 'center', minHeight: 44 }}
        >
          View all notifications
        </Link>
      </Box>
    </Box>
  );

  if (phone) {
    return (
      <Drawer
        anchor="bottom"
        open={open}
        onClose={onClose}
        slotProps={{ paper: { sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderRight: 0 } } }}
      >
        {body}
      </Drawer>
    );
  }
  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
    >
      {body}
    </Popover>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
