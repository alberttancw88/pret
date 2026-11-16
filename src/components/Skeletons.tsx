'use client';

// Loading skeletons — components.md §10.2. Each keeps the final layout's size (no shift).
import * as React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';

/** First list load: 5 skeleton rows (table body only — filter card/action bar stay real). */
export function TableSkeleton({ rows = 5, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <Box aria-busy="true" aria-label="Loading" sx={{ px: 2, py: 1 }}>
      {Array.from({ length: rows }).map((_, r) => (
        <Stack key={r} direction="row" spacing={2} sx={{ py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
          {Array.from({ length: columns }).map((__, c) => (
            <Skeleton key={c} variant="rectangular" height={20} sx={{ flex: c === 0 ? 1.4 : 1 }} />
          ))}
        </Stack>
      ))}
    </Box>
  );
}

/** Dashboard KPI tile skeleton (same outer size as KpiTile). */
export function TileSkeleton({ minHeight = 120 }: { minHeight?: number }) {
  return (
    <Card aria-busy="true" aria-label="Loading">
      <Box sx={{ p: { xs: 2, sm: 2.5 }, minHeight }}>
        <Skeleton variant="rectangular" width="60%" height={18} />
        <Skeleton variant="rectangular" width="40%" height={32} sx={{ mt: 1.5 }} />
        <Skeleton variant="rectangular" width="50%" height={14} sx={{ mt: 1.5 }} />
      </Box>
    </Card>
  );
}

/** Detail header skeleton; actions appear only after permissions are known. */
export function DetailHeaderSkeleton() {
  return (
    <Card aria-busy="true" aria-label="Loading">
      <CardContent>
        <Skeleton variant="rectangular" width={200} height={28} />
        <Stack direction="row" spacing={3} sx={{ mt: 2 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Box key={i} sx={{ flex: 1 }}>
              <Skeleton variant="rectangular" width="50%" height={14} />
              <Skeleton variant="rectangular" width="80%" height={20} sx={{ mt: 1 }} />
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

/** Phone card-list skeleton. */
export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <Stack spacing={1.5} aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <Box sx={{ p: 2, minHeight: 88 }}>
            <Skeleton variant="rectangular" width="50%" height={20} />
            <Skeleton variant="rectangular" width="80%" height={14} sx={{ mt: 1.5 }} />
            <Skeleton variant="rectangular" width="60%" height={14} sx={{ mt: 1 }} />
          </Box>
        </Card>
      ))}
    </Stack>
  );
}
