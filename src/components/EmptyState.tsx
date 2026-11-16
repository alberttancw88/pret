'use client';

// Empty states — components.md §10.1. Two kinds, never confused:
// (a) nothing exists yet (+ create action if allowed); (b) filters exclude everything (+ CLEAR).
import * as React from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import InboxOutlinedIcon from '@mui/icons-material/InboxOutlined';
import FilterAltOffOutlinedIcon from '@mui/icons-material/FilterAltOffOutlined';

export type EmptyStateProps = {
  kind?: 'none' | 'filtered';
  title: string;
  helper?: string;
  icon?: React.ElementType;
  /** Buttons (create action for 'none', CLEAR for 'filtered'). */
  actions?: React.ReactNode;
  minHeight?: number;
};

export default function EmptyState({ kind = 'none', title, helper, icon, actions, minHeight = 240 }: EmptyStateProps) {
  const Icon = icon ?? (kind === 'filtered' ? FilterAltOffOutlinedIcon : InboxOutlinedIcon);
  return (
    <Box
      role="status"
      sx={{ minHeight, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', p: 3 }}
    >
      <Stack spacing={1} alignItems="center" sx={{ maxWidth: 420 }}>
        <Icon aria-hidden sx={{ fontSize: 48, color: '#8F95A3' }} />
        <Typography variant="h6" component="p">
          {title}
        </Typography>
        {helper && (
          <Typography variant="body2" color="text.secondary">
            {helper}
          </Typography>
        )}
        {actions && (
          <Stack direction="row" spacing={1} sx={{ pt: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
