// W2-005 — pure builders for the month-end outputs (ADR-0011). No database, no server-only imports, no I/O, so
// tests/unit/w2-005-claims-outputs.test.mjs can load it directly. Rendering (.xlsx / PDF / zip) lives in ./claims-render.ts.
//
// The external column layouts are ISOLATED here, one map each:
//   * HLB_PAYMENT_LIST_LAYOUT — PRD §7.9 "Claims reimbursement payment list" (for MANUAL keying into HLB Connect First — D6).
//   * AUTOCOUNT_CLAIMS_LAYOUT — PRD §7.9 proposed AutoCount postings columns. The real AutoCount Accounting Cloud import
//     template is NOT confirmed yet (Q37): when Albert supplies it, change only this map (order / headers / formats) and bump
//     `version` — nothing else in the code depends on the column order.
// Money is a decimal string; sums use integer sen (ADR-0006).
import { formatDate } from '../../lib/format/date';
import { senToDecimal, toSen } from '../../lib/format/money';

export type Money = string;
export type ColumnFormat = 'text' | 'money' | 'date' | 'int';
export type Column<R> = { key: string; header: string; format: ColumnFormat; width: number; value: (r: R) => string | number | null };
export type Layout<R> = { code: string; version: number; columns: Column<R>[] };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2027-11-01' → 'Nov 2027' */
export function monthLabel(monthIso: string, long = false): string {
  const [y, m] = monthIso.split('-').map(Number) as [number, number];
  return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
}
export function sumMoney(values: (string | null | undefined)[]): Money {
  let s = 0n;
  for (const v of values) if (v != null && v !== '') s += toSen(v);
  return senToDecimal(s);
}
export function maskAccount(last4: string | null | undefined): string | null {
  return last4 ? `••••${last4}` : null;
}

// ---------------------------------------------------------------------------
// HLB Connect First payment list (F-CLM-15, D6, D16, D23)
// ---------------------------------------------------------------------------
export type PayeeInput = {
  employeeId: string; employeeNo: string; fullName: string; workEmail: string;
  claimNos: string[]; amount: Money;
  paymentMethod: 'bank_transfer' | 'cheque' | 'cash' | null;
  bankName: string | null; bankCode: string | null; bic: string | null;
  /** full account number — present ONLY inside generation (decrypted after the access-log row); null elsewhere */
  accountNo: string | null;
  accountLast4: string | null;
  accountHolderName: string | null;
  bankComplete: boolean;
};
export type PaymentListRow = {
  no: number; employeeNo: string; beneficiaryName: string; bank: string; bankCode: string; bic: string | null;
  accountNo: string; amount: Money; paymentReference: string; paymentDescription: string; beneficiaryEmail: string; claimNos: string;
};
export type ChequeCashRow = { no: number; employeeNo: string; name: string; method: 'cheque' | 'cash'; amount: Money; claimNos: string };
export type PaymentList = {
  rows: PaymentListRow[];
  chequeCash: ChequeCashRow[];
  /** bank-transfer payees whose bank details are incomplete (blocking) */
  incomplete: { employeeId: string; employeeNo: string; name: string }[];
  totals: { hlb: Money; chequeCash: Money; batch: Money; matches: boolean };
};

/**
 * Builds the payment list from the batch payees. D23: employees paid by cheque / cash — or with no bank record — go to the
 * separate "Pay by cheque/cash" section and are excluded from the HLB list. A bank-transfer payee with incomplete details is
 * blocking (US-CLAIM-020). Totals: HLB + cheque/cash must equal the batch total to the sen (blocking check, ADR-0011).
 */
export function buildPaymentList(payees: PayeeInput[], batch: { batchNo: string; disbursementMonth: string; total: Money }, opts: { masked?: boolean } = {}): PaymentList {
  const reference = `CLAIM ${batch.batchNo}`;
  const description = `Claims reimbursement ${monthLabel(batch.disbursementMonth)}`;
  const rows: PaymentListRow[] = []; const chequeCash: ChequeCashRow[] = []; const incomplete: PaymentList['incomplete'] = [];
  for (const p of payees) {
    if (p.paymentMethod === 'cheque' || p.paymentMethod === 'cash' || p.paymentMethod === null) {
      chequeCash.push({ no: chequeCash.length + 1, employeeNo: p.employeeNo, name: p.fullName, method: p.paymentMethod === 'cash' ? 'cash' : 'cheque',
        amount: p.amount, claimNos: p.claimNos.join(', ') });
      continue;
    }
    if (!p.bankComplete || (!opts.masked && !p.accountNo)) {
      incomplete.push({ employeeId: p.employeeId, employeeNo: p.employeeNo, name: p.fullName });
      continue;
    }
    rows.push({
      no: rows.length + 1, employeeNo: p.employeeNo, beneficiaryName: p.accountHolderName ?? p.fullName, bank: p.bankName ?? '', bankCode: p.bankCode ?? '',
      bic: p.bic, accountNo: opts.masked ? maskAccount(p.accountLast4) ?? '' : (p.accountNo ?? ''), amount: p.amount, paymentReference: reference,
      paymentDescription: description, beneficiaryEmail: p.workEmail, claimNos: p.claimNos.join(', '),
    });
  }
  const hlb = sumMoney(rows.map((r) => r.amount));
  const cc = sumMoney(chequeCash.map((r) => r.amount));
  const incompleteSum = sumMoney(payees.filter((p) => incomplete.some((i) => i.employeeId === p.employeeId)).map((p) => p.amount));
  const all = sumMoney([hlb, cc, incompleteSum]);
  return { rows, chequeCash, incomplete, totals: { hlb, chequeCash: cc, batch: batch.total, matches: incomplete.length === 0 && toSen(all) === toSen(batch.total) && toSen(sumMoney([hlb, cc])) === toSen(batch.total) } };
}

export const HLB_PAYMENT_LIST_LAYOUT: Layout<PaymentListRow> = {
  code: 'hlb_claims_payment_list', version: 1,
  columns: [
    { key: 'no', header: 'No.', format: 'int', width: 6, value: (r) => r.no },
    { key: 'employeeNo', header: 'Employee no.', format: 'text', width: 14, value: (r) => r.employeeNo },
    { key: 'beneficiaryName', header: 'Beneficiary name (account holder)', format: 'text', width: 34, value: (r) => r.beneficiaryName },
    { key: 'bank', header: 'Bank', format: 'text', width: 26, value: (r) => r.bank },
    { key: 'bankCode', header: 'Bank code / BIC', format: 'text', width: 16, value: (r) => r.bic ?? r.bankCode },
    { key: 'accountNo', header: 'Account no.', format: 'text', width: 20, value: (r) => r.accountNo },
    { key: 'amount', header: 'Amount (RM)', format: 'money', width: 14, value: (r) => r.amount },
    { key: 'paymentReference', header: 'Payment reference', format: 'text', width: 20, value: (r) => r.paymentReference },
    { key: 'paymentDescription', header: 'Payment description', format: 'text', width: 30, value: (r) => r.paymentDescription },
    { key: 'beneficiaryEmail', header: 'Beneficiary email', format: 'text', width: 30, value: (r) => r.beneficiaryEmail },
    { key: 'claimNos', header: 'Claim nos.', format: 'text', width: 34, value: (r) => r.claimNos },
  ],
};
export const CHEQUE_CASH_LAYOUT: Layout<ChequeCashRow> = {
  code: 'claims_cheque_cash', version: 1,
  columns: [
    { key: 'no', header: 'No.', format: 'int', width: 6, value: (r) => r.no },
    { key: 'employeeNo', header: 'Employee no.', format: 'text', width: 14, value: (r) => r.employeeNo },
    { key: 'name', header: 'Employee', format: 'text', width: 34, value: (r) => r.name },
    { key: 'method', header: 'Pay by', format: 'text', width: 10, value: (r) => (r.method === 'cash' ? 'Cash' : 'Cheque') },
    { key: 'amount', header: 'Amount (RM)', format: 'money', width: 14, value: (r) => r.amount },
    { key: 'claimNos', header: 'Claim nos.', format: 'text', width: 34, value: (r) => r.claimNos },
  ],
};

// ---------------------------------------------------------------------------
// AutoCount claims postings (F-CLM-27, D10, Q37 — layout to confirm)
// ---------------------------------------------------------------------------
export type PostingLineInput = {
  claimNo: string; lineNo: number; employeeNo: string; employeeName: string;
  approvedOn: string | null; disbursedOn: string | null;
  categoryName: string; description: string | null;
  /** snapshot at approval (BR-CLM-24); falls back to the category's current account */
  glAccount: string | null;
  amountExclSst: Money; sst: Money; amountInclSst: Money;
  department: string | null; costCentre: string | null;
  batchNo: string | null;
};
export type PostingRow = PostingLineInput & { documentDate: string; creditAccount: string; descriptionText: string };
/** One row per line. Document date = approval or disbursed date (C8 setting); the description = category + notes. */
export function buildPostingRows(lines: PostingLineInput[], opts: { basis: 'approval' | 'disbursed'; creditAccount: string | null }): { rows: PostingRow[]; missingGl: string[] } {
  const missingGl = [...new Set(lines.filter((l) => !l.glAccount).map((l) => l.categoryName))];
  const rows = lines.map((l) => ({
    ...l,
    documentDate: (opts.basis === 'disbursed' ? l.disbursedOn ?? l.approvedOn : l.approvedOn) ?? '',
    creditAccount: opts.creditAccount ?? '',
    descriptionText: [l.categoryName, l.description].filter(Boolean).join(' — ').slice(0, 200),
  }));
  return { rows, missingGl };
}
export const AUTOCOUNT_CLAIMS_LAYOUT: Layout<PostingRow> = {
  code: 'autocount_claims_postings', version: 1,     // PROPOSED layout (PRD §7.9) — replace with the AutoCount template (Q37)
  columns: [
    { key: 'documentDate', header: 'Document date', format: 'date', width: 14, value: (r) => r.documentDate },
    { key: 'documentNo', header: 'Document no.', format: 'text', width: 16, value: (r) => r.claimNo },
    { key: 'employeeNo', header: 'Employee no.', format: 'text', width: 14, value: (r) => r.employeeNo },
    { key: 'employeeName', header: 'Employee name', format: 'text', width: 30, value: (r) => r.employeeName },
    { key: 'glAccount', header: 'GL account', format: 'text', width: 16, value: (r) => r.glAccount },
    { key: 'description', header: 'Description', format: 'text', width: 44, value: (r) => r.descriptionText },
    { key: 'amountExclSst', header: 'Amount excl. SST', format: 'money', width: 16, value: (r) => r.amountExclSst },
    { key: 'sst', header: 'SST', format: 'money', width: 12, value: (r) => r.sst },
    { key: 'amountInclSst', header: 'Amount incl. SST', format: 'money', width: 16, value: (r) => r.amountInclSst },
    { key: 'costCentre', header: 'Department / cost centre', format: 'text', width: 22, value: (r) => r.costCentre ?? r.department },
    { key: 'creditAccount', header: 'Credit account', format: 'text', width: 16, value: (r) => r.creditAccount },
    { key: 'batchNo', header: 'Batch no.', format: 'text', width: 14, value: (r) => r.batchNo },
  ],
};

/** Applies a layout: header row + value rows (dates dd/mm/yyyy as text for CSV/PDF; the .xlsx renderer formats natively). */
export function tableOf<R>(layout: Layout<R>, rows: R[], opts: { dateAsText?: boolean } = {}): { headers: string[]; values: (string | number | null)[][] } {
  return {
    headers: layout.columns.map((c) => c.header),
    values: rows.map((r) => layout.columns.map((c) => {
      const v = c.value(r);
      if (c.format === 'date' && opts.dateAsText && typeof v === 'string') return v ? formatDate(v) : '';
      return v;
    })),
  };
}
/** Σ of a money column (totals row) — exact. */
export function columnTotal<R>(layout: Layout<R>, rows: R[], key: string): Money {
  const c = layout.columns.find((x) => x.key === key);
  if (!c) return '0.00';
  return sumMoney(rows.map((r) => (c.value(r) == null ? null : String(c.value(r)))));
}

/** Zip entry names `<claim no.>-<line>-<n>.<ext>` (FR-CLM-10). */
export function bundleEntryName(claimNo: string, lineNo: number, n: number, originalName: string, mime: string): string {
  const fromName = /\.([A-Za-z0-9]{1,5})$/.exec(originalName)?.[1]?.toLowerCase();
  const ext = fromName ?? ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'application/pdf': 'pdf' } as Record<string, string>)[mime] ?? 'bin';
  return `${claimNo}-${lineNo}-${n}.${ext}`;
}
