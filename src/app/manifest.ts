import type { MetadataRoute } from 'next';

// F-PRT-15 · US-PORTAL-017 (Could) — installable web app: "Add to home screen" opens PRET
// full-screen with the Interact icon. Deliberately NO service worker: nothing (least of all
// personal data) is cached for offline use; every screen is always read live from the server.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'PRET — Interact HR & Payroll',
    short_name: 'PRET',
    description: "Interact's internal HR & Payroll system",
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#F4F5F9',
    theme_color: '#FFFFFF',
    lang: 'en-MY',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
