// W2-006 — P20 "Download my data" (F-PRT-16, PDPA s12 / s43A): pure builders. No database, no server-only imports, no I/O,
// so tests/unit/w2-006-portal.test.mjs can load it directly. Gathering (RLS, own rows) and decryption live in
// ./my-data-gather.ts; rendering (PDF + zip) reuses ./claims-render.ts.
//
// The file is one .zip:
//   my-data.json         — machine-readable copy of every field PRET holds about the employee (portability)
//   my-data-summary.pdf  — human-readable summary (the same data, key fields)
//   README.txt           — what the file is, when it was made, how to read it
import { formatDate, formatDateTime } from '../../lib/format/date';
import type { Column, Layout } from './claims-outputs';

/** Plain JSON object (DB rows as returned by to_jsonb, decrypted identifiers added by the gatherer). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonRow = { [k: string]: Json };

export type MyDataDocument = {
  format: 'PRET my-data export';
  formatVersion: 1;
  generatedAt: string;                 // ISO instant
  company: string;
  employee: JsonRow;                   // employment record incl. department / position / grade / manager / location names
  personal: JsonRow | null;            // incl. nric (full, decrypted)
  sensitive: JsonRow | null;           // religion, OKU
  maritalHistory: JsonRow[];
  emergencyContacts: JsonRow[];
  spouses: JsonRow[];                  // incl. nric (full)
  children: JsonRow[];                 // incl. nric (full, when recorded)
  statutory: JsonRow | null;
  bankAccounts: JsonRow[];             // incl. account_no / asnb_account_no (full)
  jobHistory: JsonRow[];
  separations: JsonRow[];
  priorEmployments: JsonRow[];
  documents: JsonRow[];                // list only (titles, dates) — the files themselves are in My documents
  changeRequests: JsonRow[];           // with items
  leave: { applications: JsonRow[]; ledger: JsonRow[]; replacementCredits: JsonRow[]; balances: Json };
  claims: JsonRow[];                   // with lines
  payslips: string;                    // R1.1
};

export const MY_DATA_JSON_NAME = 'my-data.json';
export const MY_DATA_PDF_NAME = 'my-data-summary.pdf';
export const MY_DATA_README_NAME = 'README.txt';

/** 'SMP-01' + 23/11/2026 → 'my-data-SMP-01-23-11-2026.zip' (no names in the file name). */
export function myDataFileName(employeeNo: string, generatedAt: Date | string): string {
  const d = formatDate(generatedAt).replace(/\//g, '-');
  const no = employeeNo.replace(/[^A-Za-z0-9-]/g, '');
  return `my-data-${no}-${d}.zip`;
}

/** Number of records in the document (export_files.row_count). */
export function myDataRecordCount(d: MyDataDocument): number {
  const n = (a: unknown[]) => a.length;
  const lines = d.claims.reduce((s, c) => s + (Array.isArray(c.lines) ? c.lines.length : 0), 0);
  const items = d.changeRequests.reduce((s, c) => s + (Array.isArray(c.items) ? c.items.length : 0), 0);
  return 1 + (d.personal ? 1 : 0) + (d.sensitive ? 1 : 0) + (d.statutory ? 1 : 0) + n(d.maritalHistory) + n(d.emergencyContacts)
    + n(d.spouses) + n(d.children) + n(d.bankAccounts) + n(d.jobHistory) + n(d.separations) + n(d.priorEmployments) + n(d.documents)
    + n(d.changeRequests) + items + n(d.leave.applications) + n(d.leave.ledger) + n(d.leave.replacementCredits) + n(d.claims) + lines;
}

export function myDataJson(d: MyDataDocument): string {
  return `${JSON.stringify(d, null, 2)}\n`;
}

export function myDataReadme(d: MyDataDocument): string {
  return [
    'PRET — copy of your personal data',
    `${d.company}`,
    '',
    `Generated: ${formatDateTime(d.generatedAt)} (Malaysia time)`,
    `Employee no.: ${str(d.employee.employee_no)}`,
    '',
    `${MY_DATA_JSON_NAME}          every field PRET holds about you, machine-readable (JSON, UTF-8).`,
    `${MY_DATA_PDF_NAME}   a readable summary of the same data.`,
    '',
    'This file contains your MyKad number, family details and bank account numbers.',
    'Keep it private: store it somewhere safe and delete it when you no longer need it.',
    'Payslips, EA forms and payroll data will be included once payroll goes live (R1.1).',
    'If anything is wrong, use "Request a change" in My profile or contact HR.',
    '',
  ].join('\r\n');
}

// ---------------------------------------------------------------------------
// PDF summary — sections for claims-render.renderTablePdf (A4 landscape)
// ---------------------------------------------------------------------------
type R = JsonRow;
function str(v: Json | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return '';
  return String(v);
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/;
/** dd/mm/yyyy for dates, dd/mm/yyyy HH:mm for instants, text otherwise; '_' → ' ' for enum codes */
export function display(v: Json | undefined, opts: { enumLike?: boolean } = {}): string {
  const s = str(v);
  if (!s) return '';
  if (ISO_DATE.test(s)) return formatDate(s);
  if (ISO_INSTANT.test(s)) return formatDateTime(s);
  if (opts.enumLike && /^[a-z0-9_]+$/.test(s)) {
    const t = s.replace(/_/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return s;
}
const col = (key: string, header: string, width: number, format: Column<R>['format'] = 'text', enumLike = false): Column<R> => ({
  key, header, width, format,
  value: (r) => (format === 'date' ? (str(r[key]) || null) : format === 'money' ? (str(r[key]) || null) : display(r[key], { enumLike }) || null),
});
const layout = (code: string, columns: Column<R>[]): Layout<R> => ({ code, version: 1, columns });

export type SummarySection = { title: string; layout: Layout<R>; rows: R[]; emptyText?: string };
export type MyDataSummary = { title: string; header: [string, string][]; sections: SummarySection[]; footer: string };

function address(p: R | null, prefix: 'res' | 'mail'): string {
  if (!p) return '';
  return [p[`${prefix}_addr_line1`], p[`${prefix}_addr_line2`], p[`${prefix}_addr_line3`], p[`${prefix}_postcode`], p[`${prefix}_city`], p[`${prefix}_state`], p[`${prefix}_country`]]
    .map((x) => str(x)).filter(Boolean).join(', ');
}

export function buildMyDataSummary(d: MyDataDocument): MyDataSummary {
  const e = d.employee; const p = d.personal; const s = d.sensitive; const st = d.statutory;
  const marital = d.maritalHistory[0] ?? null;
  const header: [string, string][] = [
    ['Generated', `${formatDateTime(d.generatedAt)} (Malaysia time)`],
    ['Employee no.', str(e.employee_no)],
    ['Full name', str(e.full_name)],
    ['Preferred name', str(e.preferred_name)],
    ['MyKad no.', str(p?.nric)],
    ['Date of birth', display(p?.date_of_birth)],
    ['Gender', display(e.gender, { enumLike: true })],
    ['Race', display(p?.race, { enumLike: true }) + (p?.race_other ? ` (${str(p.race_other)})` : '')],
    ['Religion', display(s?.religion, { enumLike: true })],
    ['OKU', s ? (s.is_oku ? `Yes${s.oku_card_no ? ` — card ${str(s.oku_card_no)}` : ''}` : 'No') : ''],
    ['Marital status', marital ? `${display(marital.marital_status, { enumLike: true })} (from ${display(marital.effective_date)})` : ''],
    ['Passport no.', str(p?.passport_no) + (p?.passport_expiry ? ` (expires ${display(p.passport_expiry)})` : '')],
    ['Highest qualification', display(p?.highest_qualification, { enumLike: true })],
    ['Work email', str(e.work_email)],
    ['Personal email', str(p?.personal_email)],
    ['Mobile phone', str(e.mobile_phone)],
    ['Work phone', str(e.work_phone)],
    ['Residential address', address(p, 'res')],
    ['Mailing address', p?.mailing_same_as_residential ? 'Same as residential' : address(p, 'mail')],
    ['Status', display(e.status, { enumLike: true })],
    ['Join date', display(e.join_date)],
    ['Continuous service date', display(p?.continuous_service_date)],
    ['Confirmation date', display(e.confirmation_date)],
    ['Department', str(e.department)],
    ['Position', str(e.position)],
    ['Grade', str(e.grade)],
    ['Manager', str(e.manager)],
    ['Work location', str(e.work_location)],
    ['Working pattern', str(e.working_pattern)],
    ['Income tax no.', str(st?.income_tax_no)],
    ['EPF no.', str(st?.epf_no)],
    ['SOCSO no.', str(st?.socso_no)],
    ['Zakat', st?.pay_zakat ? `RM ${str(st.zakat_monthly_amount)} / month` : 'No'],
    ['PTPTN', st?.ptptn_monthly_amount ? `RM ${str(st.ptptn_monthly_amount)} / month` : 'No'],
  ].filter(([, v]) => v !== '') as [string, string][];

  const lines: R[] = d.claims.flatMap((c) => (Array.isArray(c.lines) ? (c.lines as R[]).map((l) => ({ ...l, claim_no: c.claim_no })) : []));
  const sections: SummarySection[] = [
    { title: 'Emergency contacts', layout: layout('emergency', [col('priority', 'Priority', 8), col('name', 'Name', 30), col('relationship', 'Relationship', 16, 'text', true),
        col('mobile_phone', 'Mobile', 18), col('alt_phone', 'Alternative phone', 18), col('email', 'Email', 30), col('is_next_of_kin', 'Next of kin', 10)]), rows: d.emergencyContacts },
    { title: 'Spouses', layout: layout('spouses', [col('full_name', 'Name', 30), col('nric', 'MyKad no.', 18), col('marriage_date', 'Marriage date', 14, 'date'),
        col('working_status', 'Working status', 16, 'text', true), col('income_tax_no', 'Income tax no.', 16), col('phone', 'Phone', 16), col('record_status', 'Record', 12, 'text', true)]), rows: d.spouses },
    { title: 'Children', layout: layout('children', [col('full_name', 'Name', 30), col('nric', 'MyKad / birth cert. no.', 20), col('date_of_birth', 'Date of birth', 14, 'date'),
        col('gender', 'Gender', 10, 'text', true), col('relationship', 'Relationship', 14, 'text', true), col('pcb_category', 'PCB category', 22, 'text', true), col('is_oku', 'OKU', 6)]), rows: d.children },
    { title: 'Bank and payment details', layout: layout('bank', [col('payment_method', 'Payment method', 16, 'text', true), col('bank', 'Bank', 26), col('account_type', 'Account type', 14, 'text', true),
        col('account_no', 'Account no.', 20), col('account_holder_name', 'Account holder', 26), col('asnb_account_no', 'ASNB account', 16), col('effective_from', 'Effective from', 14, 'date')]), rows: d.bankAccounts },
    { title: 'Job history', layout: layout('jobs', [col('effective_date', 'Effective', 12, 'date'), col('change_type', 'Change', 18, 'text', true), col('department', 'Department', 22),
        col('position', 'Position', 22), col('grade', 'Grade', 12), col('manager', 'Manager', 22), col('work_location', 'Work location', 20)]), rows: d.jobHistory },
    { title: 'Separation', layout: layout('separations', [col('notice_date', 'Notice date', 14, 'date'), col('separation_type', 'Type', 18, 'text', true),
        col('last_working_day', 'Last working day', 14, 'date'), col('is_withdrawn', 'Withdrawn', 10)]), rows: d.separations, emptyText: 'None.' },
    { title: 'Prior employment', layout: layout('prior', [col('employer', 'Employer', 34), col('position', 'Position', 30), col('date_from', 'From', 14, 'date'), col('date_to', 'To', 14, 'date')]), rows: d.priorEmployments },
    { title: 'Documents (list only)', layout: layout('documents', [col('title', 'Title', 40), col('category', 'Category', 22, 'text', true), col('document_date', 'Date', 14, 'date'),
        col('expiry_date', 'Expiry', 14, 'date')]), rows: d.documents },
    { title: 'Change requests', layout: layout('cr', [col('cr_no', 'Request no.', 16), col('category', 'Category', 20, 'text', true), col('status', 'Status', 12, 'text', true),
        col('effective_date', 'Effective', 12, 'date'), col('created_at', 'Submitted', 16), col('decided_at', 'Decided', 16), col('decision_remarks', 'HR remarks', 30)]), rows: d.changeRequests },
    { title: 'Leave applications', layout: layout('leave', [col('ref_no', 'Reference', 16), col('leave_type', 'Leave type', 22), col('start_date', 'From', 12, 'date'),
        col('end_date', 'To', 12, 'date'), col('days', 'Days', 7), col('status', 'Status', 18, 'text', true), col('reason', 'Reason', 30)]), rows: d.leave.applications },
    { title: 'Leave ledger', layout: layout('ledger', [col('leave_year', 'Year', 7), col('leave_type', 'Leave type', 22), col('entry_type', 'Entry', 18, 'text', true),
        col('days', 'Days', 8), col('effective_date', 'Effective', 12, 'date'), col('expires_on', 'Expires', 12, 'date'), col('reason', 'Reason', 30)]), rows: d.leave.ledger },
    { title: 'Replacement leave credits', layout: layout('credits', [col('credit_no', 'Credit no.', 16), col('date_worked', 'Date worked', 12, 'date'), col('credit_days', 'Days', 7),
        col('status', 'Status', 14, 'text', true), col('expiry_date', 'Expires', 12, 'date'), col('remaining_days', 'Remaining', 9), col('reason', 'Reason', 30)]), rows: d.leave.replacementCredits },
    { title: 'Claims', layout: layout('claims', [col('claim_no', 'Claim no.', 16), col('title', 'Title', 30), col('status', 'Status', 12, 'text', true),
        col('total_amount', 'Total (RM)', 12, 'money'), col('submitted_at', 'Submitted', 16), col('disbursed_on', 'Disbursed', 12, 'date'), col('payment_reference', 'Payment ref.', 16)]), rows: d.claims },
    { title: 'Claim lines', layout: layout('claim_lines', [col('claim_no', 'Claim no.', 16), col('line_no', 'Line', 5), col('category', 'Category', 22), col('transaction_date', 'Date', 12, 'date'),
        col('merchant', 'Merchant', 22), col('description', 'Description', 28), col('amount_incl_sst', 'Amount (RM)', 12, 'money')]), rows: lines },
  ];
  return {
    title: 'PRET — copy of my personal data',
    header,
    sections: sections.map((x) => ({ ...x, emptyText: x.emptyText ?? 'None.' })),
    footer: `${d.company} · Confidential — personal data of ${str(e.employee_no)} · Generated ${formatDate(d.generatedAt)}`,
  };
}
