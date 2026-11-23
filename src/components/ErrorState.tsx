'use client';

// Error states — components.md §10.3 / interaction-notes §3. Errors never use toasts.
//  - 'tile'   : inline small alert "Couldn't load — [RETRY]" (dashboard tiles, widgets)
//  - 'card'   : server error with reference code + [TRY AGAIN] (no stack traces)
//  - 'banner' : network failure on submit — "No connection — your entries are kept."
//  - 'page'   : S-GL-10 "Not found or no access" (identical for both cases)
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import SearchOffOutlinedIcon from '@mui/icons-material/SearchOffOutlined';
import PageTitle from './shell/PageTitle';

export type ErrorStateProps = {
  kind?: 'tile' | 'card' | 'banner' | 'page';
  message?: string;
  /** Support reference code shown on server errors. */
  reference?: string;
  onRetry?: () => void;
  homeHref?: string;
  /** 'page' inside the app shell: the shell owns the single <h1>, so the title moves there. */
  inShell?: boolean;
};

export default function ErrorState({ kind = 'card', message, reference, onRetry, homeHref = '/', inShell = false }: ErrorStateProps) {
  if (kind === 'tile') {
    return (
      <Alert
        severity="error"
        sx={{ py: 0, alignItems: 'center' }}
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {message ?? "Couldn't load"}
      </Alert>
    );
  }

  if (kind === 'banner') {
    return (
      <Alert
        severity="error"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              Try again
            </Button>
          ) : undefined
        }
      >
        {message ?? 'No connection — your entries are kept.'}
      </Alert>
    );
  }

  if (kind === 'page') {
    return (
      <Box sx={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 2, sm: 3 } }}>
        {inShell && <PageTitle title="Not found or no access" />}
        <Stack spacing={1.5} alignItems="center" sx={{ textAlign: 'center', maxWidth: 480 }}>
          <SearchOffOutlinedIcon aria-hidden sx={{ fontSize: 48, color: '#8F95A3' }} />
          <Typography variant="h3" component={inShell ? 'h2' : 'h1'}>
            Not found or no access
          </Typography>
          <Typography variant="body1" color="text.secondary">
            The page may not exist, or you may not have access to it.
          </Typography>
          <Button variant="contained" component={NextLink} href={homeHref}>
            Go to home
          </Button>
        </Stack>
      </Box>
    );
  }

  return (
    <Card>
      <CardContent>
        <Stack spacing={1.5} alignItems="flex-start" role="alert">
          <Stack direction="row" spacing={1} alignItems="center">
            <ErrorOutlineIcon aria-hidden sx={{ color: '#B42318' }} />
            <Typography variant="h6" component="p">
              {message ?? 'Something went wrong. Your changes were not saved.'}
            </Typography>
          </Stack>
          {reference && (
            <Typography variant="body2" color="text.secondary">
              Reference: <span className="pret-tnum">{reference}</span>
            </Typography>
          )}
          {onRetry && (
            <Button variant="outlined" color="inherit" onClick={onRetry}>
              Try again
            </Button>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
