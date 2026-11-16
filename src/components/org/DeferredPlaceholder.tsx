// "Available after W2-003" placeholder for screens/parts that need employee records (brief §3).
import * as React from 'react';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import HourglassEmptyOutlinedIcon from '@mui/icons-material/HourglassEmptyOutlined';

export default function DeferredPlaceholder({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', py: 6, maxWidth: 560, mx: 'auto' }} role="status">
          <HourglassEmptyOutlinedIcon aria-hidden sx={{ fontSize: 48, color: '#8F95A3' }} />
          <Typography variant="h5" component="h2">
            {title}
          </Typography>
          <Typography variant="body1" color="text.secondary">
            {body}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}
