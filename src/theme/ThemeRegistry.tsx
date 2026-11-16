'use client';

import * as React from 'react';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import 'dayjs/locale/en-gb'; // week starts Monday
import theme from './theme';

/**
 * Root providers: Emotion cache for the App Router (SSR-safe), PRET theme, baseline,
 * and date pickers fixed to DD/MM/YYYY (components.md §4).
 */
export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: 'mui' }}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <LocalizationProvider
          dateAdapter={AdapterDayjs}
          adapterLocale="en-gb"
          dateFormats={{ keyboardDate: 'DD/MM/YYYY', fullDate: 'DD/MM/YYYY' }}
          localeText={{ fieldDayPlaceholder: () => 'dd', fieldMonthPlaceholder: () => 'mm', fieldYearPlaceholder: () => 'yyyy' }}
        >
          {children}
        </LocalizationProvider>
      </ThemeProvider>
    </AppRouterCacheProvider>
  );
}
