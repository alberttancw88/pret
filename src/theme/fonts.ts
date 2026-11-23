// Plus Jakarta Sans, self-hosted by next/font (no runtime request to Google) — theme-tokens.md §1.
// Exposed as --font-jakarta; the theme's fontFamily references the variable, so the className
// must be applied to <html> in the root layout.
import { Plus_Jakarta_Sans } from 'next/font/google';

export const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  weight: 'variable',
  variable: '--font-jakarta',
});
