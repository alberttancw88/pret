import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { inter } from '@/theme/fonts';
import ThemeRegistry from '@/theme/ThemeRegistry';
import ToastProvider from '@/components/ToastProvider';

export const metadata: Metadata = {
  title: { default: 'PRET', template: '%s · PRET' },
  description: "Interact's internal HR & Payroll system",
  robots: { index: false, follow: false },
};

// viewport-fit=cover so the phone bottom bar and sticky actions can use safe-area insets.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FFFFFF',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY" className={inter.variable}>
      <body>
        <ThemeRegistry>
          <ToastProvider>{children}</ToastProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
