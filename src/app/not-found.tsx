import ErrorState from '@/components/ErrorState';

// S-GL-10 — identical response for "does not exist" and "not allowed" (EC-PRT-03).
export default function NotFound() {
  return <ErrorState kind="page" homeHref="/" />;
}
