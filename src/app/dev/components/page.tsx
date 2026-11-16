import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ComponentGallery from '@/components/dev/ComponentGallery';

export const metadata: Metadata = { title: 'Components (dev)' };
export const dynamic = 'force-dynamic';

// Dev-only component gallery for visual review. 404 in production builds.
export default function DevComponentsPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ComponentGallery />;
}
