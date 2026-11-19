// E14 Bulk update via CSV (F-EMP-25) — pure parsing, no database (unit-tested: tests/unit/w2-003-bulk-csv.test.mjs).
// The server resolves the parsed values against the masters and the employees afterwards.
import { BULK_UPDATE_HEADERS, type BulkUpdateField } from '../contracts/employees';

export const EMPLOYEE_NO_HEADER = 'Employee no.';

/** RFC 4180 CSV → rows of cells. Accepts a UTF-8 BOM, CRLF/LF, quoted cells with "" escapes and newlines. */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') { quoted = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (quoted) throw new Error('PRET-CSV-QUOTE: a quoted cell is not closed');
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Undo the formula-injection prefix our own CSV exports add ('=…, '+…, '-…, '@…). */
export function unprotectCell(v: string): string {
  const t = v.trim();
  return /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t;
}

export type ParsedBulkRow = {
  rowNo: number;                        // 1-based data row number (header = row 0)
  employeeNo: string;
  values: Partial<Record<BulkUpdateField, string>>;   // '' = blank cell (no change for that field)
};
export type BulkParseResult = {
  rows: ParsedBulkRow[];
  /** file-level problems (missing columns, duplicates, blank employee no.) — the preview shows them as error rows */
  errors: { rowNo: number; employeeNo: string; message: string }[];
  warnings: string[];
};

const norm = (h: string) => h.trim().toLowerCase().replace(/\s+/g, ' ');

/** Parses the uploaded CSV for the selected fields. Header matching is case/space-insensitive. */
export function parseBulkUpdateCsv(text: string, fields: BulkUpdateField[]): BulkParseResult {
  const errors: BulkParseResult['errors'] = [];
  const warnings: string[] = [];
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch {
    return { rows: [], errors: [{ rowNo: 0, employeeNo: '', message: 'The file is not a valid CSV (a quoted cell is not closed).' }], warnings };
  }
  if (table.length === 0) return { rows: [], errors: [{ rowNo: 0, employeeNo: '', message: 'The file is empty.' }], warnings };
  const header = table[0]!.map(norm);
  const idx = (h: string) => header.indexOf(norm(h));
  const noCol = idx(EMPLOYEE_NO_HEADER);
  if (noCol < 0) errors.push({ rowNo: 0, employeeNo: '', message: `Column "${EMPLOYEE_NO_HEADER}" is missing.` });
  const cols: Partial<Record<BulkUpdateField, number>> = {};
  for (const f of fields) {
    const i = idx(BULK_UPDATE_HEADERS[f]);
    if (i < 0) errors.push({ rowNo: 0, employeeNo: '', message: `Column "${BULK_UPDATE_HEADERS[f]}" is missing.` });
    else cols[f] = i;
  }
  const known = new Set([norm(EMPLOYEE_NO_HEADER), ...fields.map((f) => norm(BULK_UPDATE_HEADERS[f]))]);
  const extra = table[0]!.filter((h) => h.trim() !== '' && !known.has(norm(h)));
  if (extra.length) warnings.push(`Ignored columns: ${extra.join(', ')}.`);
  if (errors.length) return { rows: [], errors, warnings };

  const rows: ParsedBulkRow[] = [];
  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const rowNo = i + 1;
    const employeeNo = unprotectCell(cells[noCol!] ?? '').toUpperCase();
    if (!employeeNo) { errors.push({ rowNo, employeeNo: '', message: 'Employee no. is blank.' }); return; }
    if (seen.has(employeeNo)) {
      errors.push({ rowNo, employeeNo, message: `Employee no. ${employeeNo} appears more than once (row ${seen.get(employeeNo)}).` });
      return;
    }
    seen.set(employeeNo, rowNo);
    const values: ParsedBulkRow['values'] = {};
    for (const f of fields) values[f] = unprotectCell(cells[cols[f]!] ?? '');
    rows.push({ rowNo, employeeNo, values });
  });
  if (rows.length > 500) errors.push({ rowNo: 0, employeeNo: '', message: 'At most 500 employees per file.' });
  return { rows, errors, warnings };
}

/** "Group A; Group B" → ['Group A', 'Group B'] (blank → []). */
export function splitGroups(v: string): string[] {
  return [...new Set(v.split(';').map((s) => s.trim()).filter(Boolean))];
}
