import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

// G8 · Unknown URLs for signed-in users render "Not found or no access" inside the shell
// (the (portal) layout signs the user in first). Static routes always win over this catch-all.
export default function MissingPage() {
  notFound();
}
