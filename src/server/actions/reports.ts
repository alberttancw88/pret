'use server';

// M7 report Server Actions (W2-007). Contract: src/server/contracts/reports.ts (function register).
// Every action: requireUser(REPORT_CATALOGUE[id].roles) → zod → withUserTx (RLS) → access log → ActionResult.
// Exports contain the WHOLE filtered set (not the page), only the columns of the on-screen report (which already exclude what the
// role may not see), and write audit.access_log 'export' BEFORE the file is produced (sensitive fields + categories listed).

import { z } from 'zod';
import { sql, withUserTx } from '../db';
import { writeAccess } from '../audit';
import { fail, invalid, runAction, toObject, dbFail, type Input } from '../lib/action-helpers';
import { toCsv } from '../lib/csv';
import { renderTablePdf, renderXlsx, PDF_MIME, XLSX_MIME, type SheetSpec } from '../lib/claims-render';
import type { Column, Layout } from '../lib/claims-outputs';
import { dmy, exportCell, sumMoney } from '../lib/report-engine';
import { adminDashboardTx, buildReport, payrollInputPackTx, reportCtx } from '../queries/reports';
import {
  dashboardParamsSchema, exportPayrollInputSchema, exportReportSchema, reportIdSchema, PAYROLL_INPUT_SHEET_LABELS, REPORT_CATALOGUE,
  REPORT_EXPORT_ROW_LIMIT,
  type ActionResult, type AdminDashboard, type PayrollInputPack, type ReportColumn, type ReportDownload, type ReportResult, type ReportRow,
} from '../contracts/reports';

const ADM_SA = ['ADM', 'SA'] as const;
const TOO_MANY = 'Too many rows — narrow the filters.';
const MSGS: Record<string, string> = { 'PRET-PARAMS': 'Please check the filters.', 'PRET-ACC-404': 'Not found or no access.', 'PRET-ACC-403': 'Not found or no access.' };

// ===========================================================================
// R1 Admin dashboard — RETRY / claims period toggle
// ===========================================================================
export async function fetchAdminDashboard(params: Input): Promise<ActionResult<{ dashboard: AdminDashboard }>> {
  return runAction([...ADM_SA], dashboardParamsSchema, params, async (p, { ctx, user }) =>
    ({ dashboard: await withUserTx(ctx, (tx) => adminDashboardTx(tx, user, p)) }));
}

// ===========================================================================
// R3 viewer — SEARCH / paging (the role list depends on the report, so authorise after reading the id)
// ===========================================================================
const fetchSchema = z.object({ reportId: reportIdSchema, params: z.record(z.string(), z.unknown()).default({}) });

export async function fetchReport(input: Input): Promise<ActionResult<{ result: ReportResult }>> {
  const raw = fetchSchema.safeParse(toObject(input));
  if (!raw.success) return invalid(raw.error);
  const def = REPORT_CATALOGUE[raw.data.reportId];
  return runAction(def.roles, fetchSchema, input, async (d, { ctx, user }) => withUserTx(ctx, async (tx) =>
    ({ result: (await buildReport(await reportCtx(tx, user, d.reportId), d.reportId, d.params, { all: false })).result })), undefined, MSGS);
}

// ===========================================================================
// Export rendering (CSV / .xlsx / PDF) from the generic result
// ===========================================================================
function header(c: ReportColumn): string {
  return c.group && !c.label.startsWith(c.group) ? `${c.group} ${c.label}` : c.label;
}
function layoutOf(columns: ReportColumn[], code: string): Layout<ReportRow> {
  return {
    code, version: 1,
    columns: columns.map((c): Column<ReportRow> => ({
      key: c.key, header: header(c),
      format: c.format === 'money' ? 'money' : c.format === 'date' ? 'date' : c.format === 'int' ? 'int' : 'text',
      width: Math.max(10, Math.min(40, header(c).length + 6)),
      value: (r) => {
        const v = r.cells[c.key] ?? null;
        if (c.format === 'date' || c.format === 'money') return v === null || v === '' ? null : String(v);
        const out = exportCell(v, c.format);
        return r.badge && c === columns[0] ? `${out ?? ''} [${r.badge}]` : out;
      },
    })),
  };
}
function moneyTotals(columns: ReportColumn[], rows: ReportRow[]): Record<string, string> | undefined {
  const money = columns.filter((c) => c.format === 'money');
  if (!money.length) return undefined;
  return Object.fromEntries(money.map((c) => [c.key, sumMoney(rows.map((r) => r.cells[c.key]))]));
}
function csvOf(columns: ReportColumn[], rows: ReportRow[]): string {
  return toCsv(columns.map(header), rows.map((r) => columns.map((c, i) => {
    const v = exportCell(r.cells[c.key] ?? null, c.format);
    return i === 0 && r.badge ? `${v ?? ''} [${r.badge}]` : v;
  })));
}
const fileDate = (today: string) => dmy(today).replace(/\//g, '-');

async function render(result: ReportResult, rows: ReportRow[], format: 'csv' | 'xlsx' | 'pdf', base: string, today: string): Promise<ReportDownload> {
  const name = `${base}-${fileDate(today)}`;
  if (format === 'csv') {
    return { filename: `${name}.csv`, contentType: 'text/csv', encoding: 'utf8', content: csvOf(result.columns, rows), rowCount: rows.length };
  }
  const head: [string, string][] = [
    ['Report', result.title], ['As at', dmy(result.meta.asAt)], ['Generated', `${dmy(result.meta.generatedAt.slice(0, 10))} by ${result.meta.generatedBy}`],
    ['Scope', result.meta.scope === 'team' ? 'My team' : result.meta.scope === 'own' ? 'Own record' : 'All employees'],
    ...result.summary.map((s): [string, string] => [s.label, s.format === 'money' ? `RM ${s.value}` : s.value]),
    ...result.meta.notes.map((n): [string, string] => ['Note', n]),
  ];
  const main: SheetSpec<ReportRow> = { name: result.title.slice(0, 31), header: head, layout: layoutOf(result.columns, result.reportId), rows, totals: moneyTotals(result.columns, rows) };
  const extra = result.tables.map((t): SheetSpec<ReportRow> => ({ name: t.title.slice(0, 31), layout: layoutOf(t.columns, t.key), rows: t.rows, totals: moneyTotals(t.columns, t.rows) }));
  if (format === 'xlsx') {
    const bytes = await renderXlsx([main, ...extra] as SheetSpec<unknown>[], { title: result.title, creator: 'PRET' });
    return { filename: `${name}.xlsx`, contentType: XLSX_MIME, encoding: 'base64', content: bytes.toString('base64'), rowCount: rows.length };
  }
  const bytes = await renderTablePdf(
    { title: result.title, header: head, banner: result.meta.sensitive ? 'Sensitive — access is logged. Keep this document private.' : undefined,
      footer: `Generated ${dmy(result.meta.generatedAt.slice(0, 10))} by ${result.meta.generatedBy} · PRET` },
    [{ title: result.title, layout: main.layout, rows, totals: main.totals, emptyText: 'No results for these filters.' },
      ...extra.map((t) => ({ title: t.name, layout: t.layout, rows: t.rows, totals: t.totals, emptyText: 'None.' }))] as never,
  );
  return { filename: `${name}.pdf`, contentType: PDF_MIME, encoding: 'base64', content: bytes.toString('base64'), rowCount: rows.length };
}

// ===========================================================================
// R3 EXPORT .CSV / .XLSX / PRINT-PDF (F-RPT-24/25)
// ===========================================================================
export async function exportReport(input: Input): Promise<ActionResult<{ file: ReportDownload }>> {
  const raw = exportReportSchema.safeParse(toObject(input));
  if (!raw.success) return invalid(raw.error);
  const def = REPORT_CATALOGUE[raw.data.reportId];
  return runAction(def.roles, exportReportSchema, input, async (d, { ctx, user }) => withUserTx(ctx, async (tx) => {
    const c = await reportCtx(tx, user, d.reportId);
    const { result, built, filtered } = await buildReport(c, d.reportId, d.params, { all: true, forExport: true });
    if (filtered.length > REPORT_EXPORT_ROW_LIMIT) return fail(TOO_MANY);
    await writeAccess(tx, {
      action: 'export', entityType: `report:${d.reportId}`, entityRef: d.format, recordCount: filtered.length,
      fields: built.exportFields ?? [], categories: built.exportCategories ?? [],
      employeeIds: built.exportCategories?.length ? (built.viewLog?.employeeIds ?? []) : [],
    });
    return { file: await render(result, filtered, d.format, d.reportId, c.today) };
  }), undefined, MSGS);
}

// ===========================================================================
// R5 payroll-input pack export (.xlsx all sheets / CSV current sheet) — logged, version recorded for Reversal lines
// ===========================================================================
export async function exportPayrollInputPack(input: Input): Promise<ActionResult<{ file: ReportDownload; lastExport: PayrollInputPack['lastExport'] }>> {
  return runAction([...ADM_SA], exportPayrollInputSchema, input, async (d, { ctx, user }) => {
    try {
      return await withUserTx({ ...ctx, reason: 'Monthly payroll-input pack export (F-RPT-21)' }, async (tx) => {
        const sheet = d.sheet ?? 'joiners';
        const pre = await payrollInputPackTx(tx, user, { month: d.month, sheet }, true);
        await writeAccess(tx, { action: 'export', entityType: 'report:payroll-input', entityRef: `${d.month} ${d.format}`, employeeIds: pre.employeeIds,
          fields: ['nric', 'bank_account_no', 'epf_no', 'socso_no', 'income_tax_no'], categories: ['identity', 'bank', 'statutory'],
          recordCount: pre.pack.tabs.reduce((a, t) => a + t.count, 0) });
        const counts = Object.fromEntries(pre.pack.tabs.map((t) => [t.sheet, t.count]));
        const rec = (await sql<{ version: number; exported_at: Date }>`select * from app.record_payroll_input_export(${`${d.month}-01`}::date, ${d.format}, ${d.format === 'csv' ? sheet : null},
            ${JSON.stringify(counts)}::jsonb, ${JSON.stringify(pre.unpaidLines)}::jsonb)`.execute(tx)).rows[0]!;
        const today = (await sql<{ d: string }>`select app.today_myt()::text as d`.execute(tx)).rows[0]!.d;
        const pack = pre.pack;
        const base = `payroll-input-${d.month}`;
        let file: ReportDownload;
        if (d.format === 'csv') {
          const t = pack.tabs.find((x) => x.sheet === sheet)!;
          file = { filename: `${base}-${t.sheet.replace(/_/g, '-')}-${fileDate(today)}.csv`, contentType: 'text/csv', encoding: 'utf8', content: csvOf(t.columns, t.rows), rowCount: t.rows.length };
        } else {
          const head: [string, string][] = [['Payroll month', pack.monthLabel], ['Generated', `${dmy(today)} by ${user.displayName}`], ['Version', String(rec.version)],
            ['Note', pack.noClaimsNote], ['Confidential', 'Contains MyKad, bank account and statutory numbers — keep private (access-logged).']];
          const sheets = pack.tabs.map((t, i): SheetSpec<ReportRow> => ({ name: PAYROLL_INPUT_SHEET_LABELS[t.sheet].slice(0, 31), header: i === 0 ? head : undefined,
            layout: layoutOf(t.columns, `payroll_input_${t.sheet}`), rows: t.rows }));
          const bytes = await renderXlsx(sheets as SheetSpec<unknown>[], { title: `Payroll input ${pack.monthLabel}`, creator: 'PRET' });
          file = { filename: `${base}-${fileDate(today)}.xlsx`, contentType: XLSX_MIME, encoding: 'base64', content: bytes.toString('base64'),
            rowCount: pack.tabs.reduce((a, t) => a + t.count, 0) };
        }
        return { file, lastExport: { at: new Date(rec.exported_at).toISOString(), byName: user.displayName, version: rec.version } };
      });
    } catch (e) {
      return dbFail(e, {}, MSGS);
    }
  });
}

