'use client';

// Live password policy hints (S-GL-03). Rules per system-design §3.1: min 12 characters
// plus a character mix (Supabase strength rules; leaked-password check runs server-side).
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';

export const PASSWORD_RULES: { id: string; label: string; test: (p: string) => boolean }[] = [
  { id: 'len', label: 'At least 12 characters', test: (p) => p.length >= 12 },
  { id: 'case', label: 'Upper- and lower-case letters', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: 'digit', label: 'At least one number', test: (p) => /\d/.test(p) },
  { id: 'symbol', label: 'At least one symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export const passwordMeetsPolicy = (p: string) => PASSWORD_RULES.every((r) => r.test(p));

export default function PasswordPolicy({ password, id }: { password: string; id?: string }) {
  return (
    <Box component="ul" id={id} aria-label="Password requirements" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(password);
        return (
          <Box component="li" key={r.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
            {ok ? (
              <CheckCircleIcon aria-hidden sx={{ fontSize: 16, color: 'success.main' }} />
            ) : (
              <RadioButtonUncheckedIcon aria-hidden sx={{ fontSize: 16, color: 'grey.500' }} />
            )}
            <Typography variant="body2" sx={{ color: ok ? 'success.dark' : 'text.secondary' }}>
              {r.label}
              <Box component="span" sx={visuallyHidden}>
                {ok ? ' — met' : ' — not met'}
              </Box>
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

const visuallyHidden = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' } as const;
