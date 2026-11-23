'use client';

// Admin list density (theme-tokens.md §10): "Comfortable | Compact" pill toggle, persisted per
// browser in localStorage (`pret.density`), default comfortable. Density only — it never hides
// columns, and it is not offered on phone (card view).
import * as React from 'react';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { ThemeProvider, type Theme } from '@mui/material/styles';
import DensityMediumIcon from '@mui/icons-material/DensityMedium';
import DensitySmallIcon from '@mui/icons-material/DensitySmall';
import type { Density } from '@/theme/augment';

const KEY = 'pret.density';
const EVENT = 'pret:density-changed';

function read(): Density {
  try {
    return window.localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

/** Shared density state; every list on the page follows the same choice. */
export function useDensity(): [Density, (d: Density) => void] {
  const [density, setDensity] = React.useState<Density>('comfortable');
  React.useEffect(() => {
    setDensity(read());
    const on = () => setDensity(read());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const set = React.useCallback((d: Density) => {
    setDensity(d);
    try {
      window.localStorage.setItem(KEY, d);
    } catch {
      /* storage unavailable: the choice lasts for this page only */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [density, set];
}

export function DensityToggle({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_e, v: Density | null) => v && onChange(v)}
      aria-label="Row density"
    >
      <ToggleButton value="comfortable" sx={{ gap: 0.75 }}>
        <DensityMediumIcon sx={{ fontSize: 16 }} aria-hidden />
        Comfortable
      </ToggleButton>
      <ToggleButton value="compact" sx={{ gap: 0.75 }}>
        <DensitySmallIcon sx={{ fontSize: 16 }} aria-hidden />
        Compact
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

/** Compact filter fields: 40 px inputs (`size="small"`) for everything inside. */
export function CompactFields({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const small = React.useCallback(
    (outer: Theme) =>
      ({
        ...outer,
        components: {
          ...outer.components,
          MuiTextField: { ...outer.components?.MuiTextField, defaultProps: { ...outer.components?.MuiTextField?.defaultProps, size: 'small' } },
          MuiFormControl: { ...outer.components?.MuiFormControl, defaultProps: { ...outer.components?.MuiFormControl?.defaultProps, size: 'small' } },
          MuiAutocomplete: { ...outer.components?.MuiAutocomplete, defaultProps: { ...outer.components?.MuiAutocomplete?.defaultProps, size: 'small' } },
          MuiPickersTextField: { ...outer.components?.MuiPickersTextField, defaultProps: { ...outer.components?.MuiPickersTextField?.defaultProps, size: 'small' } },
        },
      }) as Theme,
    [],
  );
  if (!enabled) return <>{children}</>;
  return <ThemeProvider theme={small}>{children}</ThemeProvider>;
}
