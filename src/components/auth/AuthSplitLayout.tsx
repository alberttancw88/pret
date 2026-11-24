'use client';

// Sign-in split panel (S-GL-01) — components.md §9.5; Sunrise theme-tokens.md §8.7.
// Left brand panel (≥ 1024 px only): violet hero gradient, Interact logo on a white rounded
// plate, "PRET" h1, version, "HR & Payroll". Right: white panel with a max-400 px form; the logo
// repeats above the form on phone/tablet. No bottom bar here.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const LOGO_ALT = 'Interact — Business through Technology';

export default function AuthSplitLayout({ children, version }: { children: React.ReactNode; version: string }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', bgcolor: 'background.paper' }}>
      <Box
        className="pret-on-dark"
        sx={(t) => ({
          display: { xs: 'none', md: 'flex' },
          flex: '1 1 50%',
          position: 'relative',
          overflow: 'hidden',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          p: 6,
          m: 2,
          mr: 0,
          borderRadius: '28px',
          background: t.palette.brand.gradient,
          boxShadow: t.palette.brand.shadow,
          color: '#FFFFFF',
        })}
      >
        {/* Decorative circles only (never under text beyond 5.84 : 1). */}
        <Box aria-hidden sx={(t) => ({ position: 'absolute', top: -80, right: -80, width: 280, height: 280, borderRadius: '50%', bgcolor: t.palette.brand.decor, pointerEvents: 'none' })} />
        <Box aria-hidden sx={(t) => ({ position: 'absolute', bottom: -120, left: -60, width: 320, height: 320, borderRadius: '50%', bgcolor: t.palette.brand.decor, pointerEvents: 'none' })} />
        <Box sx={{ position: 'relative', bgcolor: '#FFFFFF', borderRadius: '24px', px: 3.5, py: 2.5, boxShadow: '0 12px 28px -12px rgba(31,27,59,0.45)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/interact-logo.png" alt={LOGO_ALT} style={{ width: 160, height: 'auto', display: 'block' }} />
        </Box>
        <Typography variant="h1" component="p" sx={{ mt: 2, color: '#FFFFFF', position: 'relative' }}>
          PRET
        </Typography>
        <Typography variant="body2" component="p" sx={(t) => ({ mt: -1.5, color: t.palette.brand.subtext, position: 'relative' })} className="pret-tnum">
          v{version}
        </Typography>
        <Typography variant="h5" component="p" sx={(t) => ({ color: t.palette.brand.subtext, position: 'relative' })}>
          HR &amp; Payroll
        </Typography>
      </Box>

      <Box
        component="main"
        sx={{
          flex: '1 1 50%',
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'center',
          px: 2,
          py: { xs: 4, sm: 6 },
        }}
      >
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <Box sx={{ display: { xs: 'block', md: 'none' }, textAlign: 'center', mb: 3 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/interact-logo.png" alt={LOGO_ALT} style={{ width: 140, height: 'auto' }} />
            <Typography variant="h4" component="p" sx={{ mt: 1, fontWeight: 800 }}>
              PRET
            </Typography>
            <Typography variant="caption" component="p" color="text.secondary" className="pret-tnum">
              v{version}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              HR &amp; Payroll
            </Typography>
          </Box>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
