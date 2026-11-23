import ErrorState from '@/components/ErrorState';

// G8 · S-GL-10 inside the shell — every notFound() thrown by a portal page (requireUser role
// denial, a record outside the viewer's scope, a page that doesn't exist) renders here.
// Identical for "does not exist" and "not allowed" (EC-PRT-03); "/" routes to the user's home.
export default function PortalNotFound() {
  return <ErrorState kind="page" homeHref="/" inShell />;
}
