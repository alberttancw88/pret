import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { jakarta } from '@/theme/fonts';
import ThemeRegistry from '@/theme/ThemeRegistry';
import ToastProvider from '@/components/ToastProvider';

export const metadata: Metadata = {
  title: { default: 'PRET', template: '%s · PRET' },
  description: "Interact's internal HR & Payroll system",
  robots: { index: false, follow: false },
  // F-PRT-15 PWA (manifest.ts): iOS home-screen icon and standalone launch.
  applicationName: 'PRET',
  appleWebApp: { capable: true, title: 'PRET', statusBarStyle: 'default' },
  icons: { icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }], apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }] },
  formatDetection: { telephone: false },
};

// viewport-fit=cover so the phone bottom bar and sticky actions can use safe-area insets.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#F7F4FF',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-MY" className={jakarta.variable}>
      <body>
        <ThemeRegistry>
          <ToastProvider>{children}</ToastProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
