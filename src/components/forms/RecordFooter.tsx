// Record footer (FR-G-13, wireframes §0.3):
// "Created by {name} at dd/mm/yyyy HH:mm · Last updated by {name} at dd/mm/yyyy HH:mm".
import * as React from 'react';
import Typography from '@mui/material/Typography';
import { formatDateTime } from '@/lib/format';

export type RecordMeta = {
  createdAt?: string | Date | null;
  createdByName?: string | null;
  updatedAt?: string | Date | null;
  updatedByName?: string | null;
};

export default function RecordFooter({ meta }: { meta?: RecordMeta | null }) {
  if (!meta || (!meta.createdAt && !meta.updatedAt)) return null;
  const parts: string[] = [];
  if (meta.createdAt) parts.push(`Created by ${meta.createdByName ?? 'System'} at ${formatDateTime(meta.createdAt)}`);
  if (meta.updatedAt) parts.push(`Last updated by ${meta.updatedByName ?? 'System'} at ${formatDateTime(meta.updatedAt)}`);
  return (
    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }} className="pret-tnum">
      {parts.join(' · ')}
    </Typography>
  );
}
