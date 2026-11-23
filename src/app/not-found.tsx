import ErrorState from '@/components/ErrorState';

// G8 · S-GL-10 outside the shell (fallback) — identical response for "does not exist" and
// "not allowed" (EC-PRT-03). Signed-in users normally see the in-shell version.
export default function NotFound() {
  return <ErrorState kind="page" homeHref="/" />;
}
