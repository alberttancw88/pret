'use client';

// KPI / dashboard tile — dashboard-visuals.md §1, Sunrise theme-tokens.md §8.5.
//   quiet  (default): white bordered card, 4 px left accent in the tone colour, number in
//                     text.primary. Required on money and approval screens (calm rule 3).
//   pastel:           pastel tile bg, one ink colour for label / number / sub-text. At most
//                     4 per strip, one hue per tile (lavender, sky, peach, mint by position).
// The accent and the pastel are decoration: meaning is always in the label and the number.
// When `href` is set the whole tile is a link with a › affordance.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { TileName, ToneName } from '@/theme/augment';
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
  /** Quiet variant: colour of the 4 px accent. */
  tone?: ToneName;
  /** `quiet` (default) or `pastel` (theme-tokens.md §8.5). */
  variant?: 'quiet' | 'pastel';
  /** Pastel variant: tile hue (by position in the strip: lavender, sky, peach, mint). */
  hue?: TileName;
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

/** Hue for the n-th pastel tile in a strip (§8.5). */
export const PASTEL_ORDER: TileName[] = ['lavender', 'sky', 'peach', 'mint'];

export default function KpiTile({
  label,
  value,
  unit,
  secondary,
  subLine,
  tone = 'grey',
  variant = 'quiet',
  hue = 'lavender',
  href,
  loading,
  error,
  minHeight = 112,
  children,
}: KpiTileProps) {
  if (loading) return <TileSkeleton minHeight={minHeight} />;
  const pastel = variant === 'pastel';
  // On a pastel tile every text uses the tile's ink (one pair to check, §3.3).
  const ink = (fallback: string) => (pastel ? `tile.${hue}.ink` : fallback);

  const inner = (
    <Box sx={{ display: 'flex', height: '100%', minHeight }}>
      {!pastel && <Box aria-hidden sx={(t) => ({ width: 4, flexShrink: 0, bgcolor: t.palette.tone[tone].solid })} />}
      <Box sx={{ px: { xs: 2, sm: 2.5 }, py: { xs: 1.75, sm: 2.25 }, flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Typography variant="caption" component="h3" sx={{ fontWeight: 700, lineHeight: '16px', color: ink('text.secondary') }}>
            {label}
          </Typography>
          {href && <ChevronRightIcon aria-hidden sx={{ fontSize: 18, color: ink('primary.dark'), mt: '-1px' }} />}
        </Stack>
        {error ? (
          <Box sx={{ mt: 1 }}>
            <ErrorState kind="tile" onRetry={error.onRetry} />
          </Box>
        ) : (
          <>
            {value !== undefined && (
              <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap' }}>
                <Typography variant="kpi" component="p" sx={{ color: ink('text.primary') }}>
                  {value}
                </Typography>
                {unit && (
                  <Typography variant="body2" fontWeight={600} sx={{ color: ink('text.secondary') }}>
                    {unit}
                  </Typography>
                )}
                {secondary && (
                  <Typography variant="body2" sx={{ color: ink('text.secondary') }}>
                    {secondary}
                  </Typography>
                )}
              </Stack>
            )}
            {subLine && (
              <Typography variant="caption" component="div" sx={{ mt: 0.5, color: ink('text.secondary') }}>
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
    <Card
      sx={{
        height: '100%',
        ...(pastel && { bgcolor: `tile.${hue}.bg`, border: 'none' }),
        ...(href && { transition: 'box-shadow 150ms', '&:hover': { boxShadow: 1 } }),
      }}
    >
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
