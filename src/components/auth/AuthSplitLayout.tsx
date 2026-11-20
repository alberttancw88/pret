'use client';

// Sign-in split panel (S-GL-01) — components.md §9.5. Left brand panel (≥ 1024 px only):
// gradient, Interact logo 160 px, "PRET" h1, "HR & Payroll" h5. Right: white panel with a
// max-400 px form; the logo repeats above the form on phone/tablet. No bottom bar here.
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

const LOGO_ALT = 'Interact — Business through Technology';

export default function AuthSplitLayout({ children, version }: { children: React.ReactNode; version: string }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', bgcolor: 'background.paper' }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flex: '1 1 50%',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          p: 6,
          background: 'linear-gradient(160deg,#EDEDFE 0%,#F4F5F9 70%)',
          borderRight: '1px solid',
          borderColor: 'divider',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/interact-logo.png" alt={LOGO_ALT} style={{ width: 160, height: 'auto' }} />
        <Typography variant="h1" component="p" sx={{ mt: 2 }}>
          PRET
        </Typography>
        <Typography variant="body2" component="p" color="text.secondary" sx={{ mt: -1.5 }}>
          v{version}
        </Typography>
        <Typography variant="h5" component="p" color="text.secondary">
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
            <Typography variant="h5" component="p" sx={{ mt: 1 }}>
              PRET
            </Typography>
            <Typography variant="caption" component="p" color="text.secondary">
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
