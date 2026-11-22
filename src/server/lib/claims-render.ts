import 'server-only';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { formatAmount } from '../../lib/format/money';
import { formatDate } from '../../lib/format/date';
import type { Column, Layout } from './claims-outputs';

// W2-005 renderers (ADR-0011): .xlsx (exceljs), printable PDF (pdf-lib — pure JS, standard fonts, no headless browser, fits
// Vercel Hobby), zip (jszip). Inputs come from the pure builders in ./claims-outputs.ts; nothing here touches the database.

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const PDF_MIME = 'application/pdf';
export const ZIP_MIME = 'application/zip';

export type SheetSpec<R> = {
  name: string;
  /** label / value lines above the table (report header) */
  header?: [string, string][];
  layout: Layout<R>;
  rows: R[];
  /** totals row: column key → value (money strings) */
  totals?: Record<string, string>;
  totalsLabel?: string;
};

function cellValue<R>(c: Column<R>, r: R): ExcelJS.CellValue {
  const v = c.value(r);
  if (v === null || v === undefined || v === '') return null;
  if (c.format === 'money') return Number(v);            // display only; the exact sum is in the totals row (string → number at 2 dp)
  if (c.format === 'int') return Number(v);
  if (c.format === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, d));
  }
  return String(v);
}

/** One workbook, one or more sheets. Money cells #,##0.00; dates dd/mm/yyyy; header rows bold. */
export async function renderXlsx(sheets: SheetSpec<unknown>[], meta: { title: string; creator: string }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.creator; wb.title = meta.title; wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    let row = 1;
    for (const [k, v] of s.header ?? []) {
      ws.getCell(row, 1).value = k; ws.getCell(row, 1).font = { bold: true };
      ws.getCell(row, 2).value = v;
      row += 1;
    }
    if (s.header?.length) row += 1;
    const headerRow = ws.getRow(row);
    s.layout.columns.forEach((c, i) => {
      headerRow.getCell(i + 1).value = c.header;
      headerRow.getCell(i + 1).font = { bold: true };
      headerRow.getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } };
      ws.getColumn(i + 1).width = c.width;
    });
    row += 1;
    for (const r of s.rows) {
      const xr = ws.getRow(row);
      s.layout.columns.forEach((c, i) => {
        const cell = xr.getCell(i + 1);
        cell.value = cellValue(c, r);
        if (c.format === 'money') { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' }; }
        if (c.format === 'date') cell.numFmt = 'dd/mm/yyyy';
        if (c.format === 'text') cell.numFmt = '@';
      });
      row += 1;
    }
    if (s.totals) {
      const tr = ws.getRow(row);
      tr.getCell(1).value = s.totalsLabel ?? 'Total';
      tr.getCell(1).font = { bold: true };
      s.layout.columns.forEach((c, i) => {
        if (s.totals![c.key] !== undefined) {
          const cell = tr.getCell(i + 1);
          cell.value = Number(s.totals![c.key]); cell.numFmt = '#,##0.00'; cell.font = { bold: true }; cell.alignment = { horizontal: 'right' };
        }
      });
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// PDF (A4 landscape, Helvetica — WinAnsi; characters outside it are replaced)
// ---------------------------------------------------------------------------
function safe(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}
function fit(font: PDFFont, s: string, size: number, width: number): string {
  let t = safe(font, s);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t}…`;
}

export type PdfSection<R> = { title: string; layout: Layout<R>; rows: R[]; totals?: Record<string, string>; totalsLabel?: string; emptyText?: string };

export async function renderTablePdf(doc: { title: string; header: [string, string][]; banner?: string; footer?: string },
                                     sections: PdfSection<unknown>[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title); pdf.setProducer('PRET'); pdf.setCreator('PRET');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89; const H = 595.28; const M = 28; const size = 7.5; const lh = 12;
  let page: PDFPage = pdf.addPage([W, H]); let y = H - M;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const text = (s: string, x: number, f: PDFFont, sz: number, color = rgb(0.1, 0.1, 0.1)) => page.drawText(safe(f, s), { x, y, size: sz, font: f, color });
  text(doc.title, M, bold, 13); y -= 18;
  for (const [k, v] of doc.header) {
    if (y < M + 40) newPage();
    text(`${k}:`, M, bold, 8); text(v, M + 140, font, 8); y -= 11;
  }
  if (doc.banner) { y -= 4; text(doc.banner, M, bold, 8, rgb(0.6, 0.25, 0)); y -= 14; }
  for (const s of sections) {
    const total = s.layout.columns.reduce((a, c) => a + c.width, 0);
    const scale = (W - 2 * M) / total;
    const xs: number[] = []; let x = M;
    for (const c of s.layout.columns) { xs.push(x); x += c.width * scale; }
    const drawHeader = () => {
      page.drawRectangle({ x: M, y: y - 3, width: W - 2 * M, height: lh, color: rgb(0.93, 0.95, 0.97) });
      s.layout.columns.forEach((c, i) => text(fit(bold, c.header, size, c.width * scale - 4), xs[i]! + 2, bold, size));
      y -= lh;
    };
    if (y < M + 60) newPage();
    y -= 6; text(s.title, M, bold, 10); y -= 14;
    drawHeader();
    if (s.rows.length === 0) { text(s.emptyText ?? 'None.', M + 2, font, size); y -= lh; }
    for (const r of s.rows) {
      if (y < M + 20) { newPage(); drawHeader(); }
      s.layout.columns.forEach((c, i) => {
        const raw = c.value(r);
        let v = raw === null || raw === undefined ? '' : String(raw);
        if (c.format === 'money' && v) v = formatAmount(v, { plain: true });
        if (c.format === 'date' && v) v = formatDate(v);
        const w = c.width * scale - 4;
        const t = fit(font, v, size, w);
        const tx = c.format === 'money' ? xs[i]! + 2 + w - font.widthOfTextAtSize(t, size) : xs[i]! + 2;
        text(t, tx, font, size);
      });
      y -= lh;
    }
    if (s.totals) {
      if (y < M + 20) newPage();
      page.drawLine({ start: { x: M, y: y + lh - 2 }, end: { x: W - M, y: y + lh - 2 }, thickness: 0.5, color: rgb(0.5, 0.5, 0.5) });
      text(s.totalsLabel ?? 'Total', xs[0]! + 2, bold, size);
      s.layout.columns.forEach((c, i) => {
        const v = s.totals![c.key];
        if (v === undefined) return;
        const w = c.width * scale - 4; const t = formatAmount(v, { plain: true });
        text(t, xs[i]! + 2 + w - bold.widthOfTextAtSize(t, size), bold, size);
      });
      y -= lh + 4;
    }
  }
  if (doc.footer) {
    const pages = pdf.getPages();
    pages.forEach((p, i) => p.drawText(safe(font, `${doc.footer} · Page ${i + 1} of ${pages.length}`), { x: M, y: 14, size: 7, font, color: rgb(0.4, 0.4, 0.4) }));
  }
  return Buffer.from(await pdf.save());
}

export async function renderZip(entries: { name: string; bytes: Buffer }[]): Promise<Buffer> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const e of entries) {
    let n = e.name; let k = 2;
    while (used.has(n)) { n = e.name.replace(/(\.[^.]+)?$/, (m) => `(${k})${m}`); k += 1; }
    used.add(n);
    zip.file(n, e.bytes);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
