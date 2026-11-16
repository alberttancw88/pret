'use client';

// Money display — components.md §5. "RM 1,234.56"; tables "1,234.56" under "(RM)";
// negatives "−RM 12.00" (U+2212); masked "RM ••••" + Show/Hide for sensitive amounts.
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography, { type TypographyProps } from '@mui/material/Typography';
import { formatAmount, formatMoney } from '@/lib/format';

export type MoneyTextProps = {
  amount: number | string | null | undefined;
  /** 'display' = "RM 1,234.56" (default) · 'table' = "1,234.56" (header carries "(RM)"). */
  mode?: 'display' | 'table';
  /** Sensitive values (net pay, salary) start hidden with a Show/Hide text button. */
  masked?: boolean;
  /** What is being revealed, for the button's accessible name (e.g. "net pay"). */
  maskedLabel?: string;
  bold?: boolean;
  variant?: TypographyProps['variant'];
  component?: React.ElementType;
};

export default function MoneyText({
  amount,
  mode = 'display',
  masked = false,
  maskedLabel = 'amount',
  bold,
  variant = 'inherit',
  component = 'span',
}: MoneyTextProps) {
  const [revealed, setRevealed] = React.useState(false);
  const text = mode === 'table' ? formatAmount(amount) : formatMoney(amount);
  const hidden = masked && !revealed;

  const value = (
    <Typography
      variant={variant}
      component={component}
      className="pret-tnum"
      aria-label={hidden ? 'Amount hidden' : undefined}
      sx={{ fontWeight: bold ? 700 : undefined, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
    >
      {hidden ? (mode === 'table' ? '••••' : 'RM ••••') : text || '—'}
    </Typography>
  );

  if (!masked) return value;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {value}
      <Button
        variant="text"
        size="small"
        onClick={() => setRevealed((r) => !r)}
        aria-pressed={revealed}
        aria-label={`${revealed ? 'Hide' : 'Show'} ${maskedLabel}`}
        sx={{ minWidth: 0, px: 1, textTransform: 'none' }}
      >
        {revealed ? 'Hide' : 'Show'}
      </Button>
    </Box>
  );
}
