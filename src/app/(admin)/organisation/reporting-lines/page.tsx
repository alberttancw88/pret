import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import DeferredPlaceholder from '@/components/org/DeferredPlaceholder';

export const metadata: Metadata = { title: 'Reporting lines' };
export const dynamic = 'force-dynamic';

// O8 · S-OR-08 · /organisation/reporting-lines — Admin and Super Admin (F-ORG-11).
// Deferred to W2-003: reporting lines need employee records.
export default async function ReportingLinesPage() {
  await requireUser(['ADM', 'SA']);
  return (
    <DeferredPlaceholder
      title="Reporting lines arrive with employee records"
      body="The reporting-line tree, reassigning reportees and the “Reportees without an active manager” alert need employee records. They will be available after W2-003 (employee master records)."
    />
  );
}
