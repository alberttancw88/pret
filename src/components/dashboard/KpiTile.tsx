'use client';

// Dashboard tile — dashboard-visuals.md §1. White bordered card, 4 px tone accent
// (decorative; meaning is always in the text), whole tile is a link with a › affordance.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { ToneName } from '@/theme/augment';
import ErrorState from '../ErrorState';
import { TileSkeleton } from '../Skeletons';

export type KpiTileProps = {
  label: string;
  value?: React.ReactNode;
  /** Unit/suffix after the value ("d", "days"). */
  unit?: string;
  /** Text right after the value, e.g. "(2 at Admin level)". */
  secondary?: React.ReactNode;
  subLine?: React.ReactNode;
  tone?: ToneName;
  href?: string;
  loading?: boolean;
  error?: { onRetry?: () => void } | null;
  minHeight?: number;
  children?: React.ReactNode;
};

export const GRID_SX = {
  display: 'grid',
  gap: 2,
  gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(auto-fill, minmax(176px, 1fr))' },
} as const;

export default function KpiTile({
  label,
  value,
  unit,
  secondary,
  subLine,
  tone = 'grey',
  href,
  loading,
  error,
  minHeight = 112,
  children,
}: KpiTileProps) {
  if (loading) return <TileSkeleton minHeight={minHeight} />;

  const inner = (
    <Box sx={{ display: 'flex', height: '100%', minHeight }}>
      <Box aria-hidden sx={(t) => ({ width: 4, flexShrink: 0, bgcolor: t.palette.tone[tone].solid })} />
      <Box sx={{ p: { xs: 2, sm: 2.5 }, flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Typography variant="h6" component="h3" color="text.secondary" sx={{ fontSize: { xs: '0.875rem', sm: '1rem' } }}>
            {label}
          </Typography>
          {href && <ChevronRightIcon aria-hidden sx={{ fontSize: 16, color: '#4548C9', mt: 0.5 }} />}
        </Stack>
        {error ? (
          <Box sx={{ mt: 1 }}>
            <ErrorState kind="tile" onRetry={error.onRetry} />
          </Box>
        ) : (
          <>
            {value !== undefined && (
              <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="kpi" component="p">
                  {value}
                </Typography>
                {unit && (
                  <Typography variant="body2" fontWeight={500} color="text.secondary">
                    {unit}
                  </Typography>
                )}
                {secondary && (
                  <Typography variant="body2" color="text.secondary">
                    {secondary}
                  </Typography>
                )}
              </Stack>
            )}
            {subLine && (
              <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }}>
                {subLine}
              </Typography>
            )}
            {children}
          </>
        )}
      </Box>
    </Box>
  );

  return (
    <Card sx={{ height: '100%' }}>
      {href && !error ? (
        <CardActionArea component={NextLink} href={href} sx={{ height: '100%' }}>
          {inner}
        </CardActionArea>
      ) : (
        inner
      )}
    </Card>
  );
}

/** Overline section label for dashboards ("HR", "Claims"). */
export function DashboardSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 4, '&:first-of-type': { mt: 0 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="overline" component="h2" color="text.secondary">
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Box>
  );
}
