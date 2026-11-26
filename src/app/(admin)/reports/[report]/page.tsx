import type { Metadata } from 'next';
import { notFound, unstable_rethrow } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getReportFilterOptions, runReport } from '@/server/queries/reports';
import { REPORT_CATALOGUE, reportIdSchema, type AnyReportParams, type ReportResult } from '@/server/contracts/reports';
import ReportViewer from '@/components/reports/ReportViewer';
import { defaultFilters, toReportParams } from '@/components/reports/reportFilters';
import { reportErrorMessage } from '@/components/reports/errors';
import { readListParams, type SearchParamsRecord } from '@/lib/list-params';
import { todayMyt } from '@/lib/format';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ report: string }>; searchParams: Promise<SearchParamsRecord> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const parsed = reportIdSchema.safeParse((await params).report);
  return { title: parsed.success ? REPORT_CATALOGUE[parsed.data].name : 'Reports' };
}

// R3 · S-RP-03 · /reports/{report} — every R4 report (S-RP-04…22) and P7 / S-RP-24 (leave-individual).
// Roles per REPORT_CATALOGUE[id].roles (page), again in runReport / exportReport and by RLS. MGR: team-scope
// reports only (scope forced by the server). EMP: leave-individual only (fixed to self).
export default async function ReportPage({ params, searchParams }: Props) {
  const parsed = reportIdSchema.safeParse((await params).report);
  if (!parsed.success) notFound();
  const id = parsed.data;
  const def = REPORT_CATALOGUE[id];
  await requireUser(def.roles);
  const sp = await searchParams;
  // Filter options first: their defaults (as-at today, this month, current year …) are the URL defaults on both sides,
  // so the query always receives exactly what the filter card shows.
  const options = await getReportFilterOptions(id);
  const lp = readListParams(sp, { filters: defaultFilters(id, options.defaults) });
  const raw = toReportParams(id, lp.filters, { page: lp.page, pageSize: lp.rowsPerPage, sort: lp.sort });

  let result: ReportResult | null = null;
  let error: string | null = null;
  try {
    result = await runReport(id, raw as AnyReportParams);
  } catch (e) {
    unstable_rethrow(e);
    error = reportErrorMessage(e);
  }

  return (
    <ReportViewer
      def={{ id, name: def.name, description: def.description, screenId: def.screenId, sensitive: def.sensitive, loadsOnSearch: def.loadsOnSearch }}
      result={result}
      error={error}
      options={options}
      today={todayMyt()}
    />
  );
}
