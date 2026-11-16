// Inter, self-hosted by next/font (no runtime request to Google) — design-system.md §3.
// Exposed as --font-inter; the theme's fontFamily references the variable, so the
// className must be applied to <html> in the root layout.
import { Inter } from 'next/font/google';

export const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
});
