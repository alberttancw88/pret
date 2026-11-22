'use server';

// M3 Claims Server Actions (W2-005). Contract: src/server/contracts/claims.ts (function register).
// Each action: requireUser([...roles]) → zod → withUserTx (RLS + the database engine and guards: app.save_claim /
// app.submit_claim / app.claim_evaluate, transition triggers, no self-approval, batch status machine) → audit (DB trigger) /
// access log (exports, receipt downloads, payment-list generation, zips) → ActionResult.
// Bank account numbers are decrypted ONLY inside generateBatchOutputs (after the access-log row) and only into the HLB
// .xlsx / PDF — never into CSV, logs or error messages (brief rule 4).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { writeAccess } from '../audit';
import { fieldCrypto } from '../crypto';
import { confirmUpload, getDownloadUrl, readFilesForBundle, requestUpload, storeGeneratedFile } from '../storage';
import { dbFail, fail, NO_ACCESS, runAction, type Authorized, type Input } from '../lib/action-helpers';
import type { ActionFail } from '../contracts/common';
import { csvDate, csvDateTime, csvFile } from '../lib/csv';
import {
  AUTOCOUNT_CLAIMS_LAYOUT, CHEQUE_CASH_LAYOUT, HLB_PAYMENT_LIST_LAYOUT, buildPaymentList, buildPostingRows, bundleEntryName, columnTotal, monthLabel, sumMoney,
  type PostingLineInput, type PostingRow,
} from '../lib/claims-outputs';
import { PDF_MIME, XLSX_MIME, ZIP_MIME, renderTablePdf, renderXlsx, renderZip, type SheetSpec } from '../lib/claims-render';
import {
  applyLateOverrideSchema, approverHintSchema, attachmentBundleSchema, autocountExportSchema, batchCandidatesSchema, batchClaimsChangeSchema, batchDefaultsSchema,
  batchIdSchema, batchListParamsSchema, batchPreviewSchema, bulkClaimsSchema, cancelBatchSchema, cancelClaimSchema, categoryListParamsSchema, checkClaimLineSchema,
  claimEmployeeOptionsSchema, claimIdSchema, claimListParamsSchema, claimReceiptUrlSchema, copyClaimSchema, createBatchSchema, employeeClaimsParamsSchema, endLimitSchema,
  exportFileUrlSchema, fileIdSchema, lateOverrideCandidatesSchema, lateOverrideListParamsSchema, limitListParamsSchema, markBatchDisbursedSchema, mileageAmountSchema,
  myClaimsParamsSchema, removeBatchClaimSchema, requestClaimUploadSchema, saveCategorySchema, saveClaimSchema, saveLimitSchema, setCategoryActiveSchema, submitClaimSchema,
  paymentListReportSchema, undoDisbursementSchema, updateClaimPolicySchema, uuidSchema, mileageAmount, HLB_MANUAL_BANNER,
  BATCH_STATUS_LABELS, CLAIM_FLAG_LABELS, CLAIM_GROUP_LABELS, CLAIM_STATUS_LABELS, LIMIT_APPLIES_TO_LABELS, LIMIT_BEHAVIOUR_LABELS, TAX_TREATMENT_LABELS,
  type ActionResult, type AttachmentBundlePreview, type AttachmentBundleResult, type AutocountPreview, type BatchCandidates, type BatchDefaults, type BatchPreview,
  type BulkClaimPreview, type BulkClaimResult, type ClaimEmployeeOption, type ClaimForm, type ClaimIssue, type ClaimLineCheck, type CreateBatchResult, type CsvFile,
  type DownloadUrl, type EmployeeClaimsTab, type GenerateOutputsResult, type LateOverrideCandidate, type MarkBatchDisbursedResult, type MileageAmountResult, type OutputKind, type PaymentListReport,
  type SaveClaimResult, type SubmitClaimResult, type UploadIntent, type ValidateClaimResult,
} from '../contracts/claims';
import {
  batchCandidates, batchDefaults, batchPreview, batchRows, bundleFiles, categoryRows, claimEmployeeOptions, claimFormFor, claimListPage, employeeClaimsTab,
  decryptPayees, lateOverrideCandidates, lateOverrideRows, limitRows, m2, myClaimRows, paymentListReport, payeesOf, payeeRow, postingLines,
} from '../queries/claims';
import { dbIsAdmin, myEmployeeId, personRef, todayMyt } from '../queries/leave';

const ANY: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
const ADMIN: Role[] = ['ADM', 'SA'];
const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
const NOT_FOUND = { ok: false as const, error: NO_ACCESS };
const MSGS: Record<string, string> = {
  'PRET-SELF-001': "You can't decide your own claim.",
  'PRET-CLM-LOCKED': 'Only New claims can be edited.',
  'PRET-STALE': 'This claim changed since you opened it — refresh and try again.',
  'PRET-CLM-NO-EMPLOYEE': 'Your employee record has not been created yet.',
};
const BUNDLE_MAX_BYTES = 9.5 * 1024 * 1024;
const BUNDLE_MAX_FILES = 300;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const rmPlain = (v: string) => `RM ${Number(v).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** PRET-CLM-FIELD / PRET-BATCH-FIELD "lines.2.amountInclSst: message" → fieldErrors. */
function fieldFail(err: unknown) {
  const msg = String((err as { message?: string })?.message ?? '');
  const m = /PRET-(?:CLM|BATCH)-FIELD\s+([A-Za-z0-9_.]+):\s*(.+)$/.exec(msg);
  if (m) {
    const text = m[2]!.charAt(0).toUpperCase() + m[2]!.slice(1);
    return fail(/[.!?]$/.test(text) ? text : `${text}.`, { [m[1]!]: /[.!?]$/.test(text) ? text : `${text}.` });
  }
  if ((err as { constraint?: string })?.constraint === 'ux_myinvois_uuid_live') return fail('This MyInvois UUID is already claimed.', { form: 'This MyInvois UUID is already claimed.' });
  return dbFail(err, {}, MSGS);
}
async function act<S extends z.ZodTypeAny, T extends object>(roles: Role[], schema: S, input: Input, fn: (d: z.output<S>, a: Authorized) => Promise<T | ActionFail>) {
  return runAction<S, T>(roles, schema, input, async (d, a) => {
    try { return await fn(d, a); } catch (e) { return fieldFail(e); }
  }, undefined, MSGS);
}
function issuesOf(list: R[] | null | undefined): ClaimIssue[] {
  return (list ?? []).map((i) => ({ lineNo: i.lineNo ?? null, lineId: i.lineId ?? null, code: i.code, field: i.field ?? null, severity: i.severity, message: i.message }));
}
const linePayload = (l: z.output<typeof saveClaimSchema>['lines'][number]) => ({
  id: l.id ?? null, categoryId: l.categoryId, transactionDate: l.transactionDate, description: l.description, merchant: l.merchant, receiptNo: l.receiptNo,
  myinvoisUuid: l.myinvoisUuid, amountInclSst: l.amountInclSst, sstAmount: l.sstAmount, fromPlace: l.fromPlace, toPlace: l.toPlace, purpose: l.purpose,
  distanceKm: l.distanceKm, clientAttendees: l.clientAttendees, travelDestination: l.travelDestination, claimant: l.claimant, dependantName: l.dependantName,
  costCentreId: l.costCentreId, fileIds: l.fileIds,
});
async function saveTx(tx: Tx, d: z.output<typeof saveClaimSchema>): Promise<SaveClaimResult> {
  const payload = { claimId: d.claimId ?? null, expectedVersion: d.expectedVersion ?? null, employeeId: d.employeeId ?? null, onBehalfNote: d.onBehalfNote,
    title: d.title, projectRef: d.projectRef, idempotencyKey: d.idempotencyKey, lines: d.lines.map(linePayload) };
  const j = (await sql<{ j: R }>`select app.save_claim(${JSON.stringify(payload)}::jsonb) as j`.execute(tx)).rows[0]!.j;
  return { id: j.id, claimNo: j.claimNo, version: j.version, totals: j.totals, lineIds: j.lineIds ?? [], duplicate: !!j.duplicate };
}
async function claimIdByNo(tx: Tx, id: string): Promise<R | undefined> {
  return (await sql<R>`select id, claim_no, employee_id, status::text as status from app.claims where id = ${id}::uuid`.execute(tx)).rows[0];
}

// ===========================================================================
// C5 / C6 / C7 / C8 setup
// ===========================================================================
export async function exportCategoriesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return act(ADMIN, categoryListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await categoryRows(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'claim_categories', recordCount: rows.length });
    return csvFile('claim-categories', ['Code', 'Name', 'Group', 'Receipt required', 'Mileage rate (RM/km)', 'Limits', 'Tax treatment', 'GL account', 'Display order', 'Active'],
      rows.map((r) => [r.code, r.name, CLAIM_GROUP_LABELS[r.group], r.receiptRequired, r.mileageRate, r.limitsSummary, TAX_TREATMENT_LABELS[r.taxTreatment], r.glAccountCode,
        r.displayOrder, r.isActive]));
  }));
}
export async function saveCategory(input: Input): Promise<ActionResult<{ id: string; code: string }>> {
  return act(ADMIN, saveCategorySchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const v = {
      code: d.code, name: d.name, claim_group: d.group, description: d.description, receipt_required: d.receiptRequired, notes_required: d.notesRequired,
      receipt_no_mode: d.receiptNoMode, myinvois_uuid_mode: d.myinvoisUuidMode, capture_sst: d.captureSst, is_mileage: d.isMileage, extra_fields: d.extraFields,
      claimant_scope: d.claimantScope, min_service_months: d.minServiceMonths, eligible_statuses: d.eligibleStatuses, tax_treatment: d.taxTreatment,
      ea_form_line: d.eaFormLine, gl_account_code: d.glAccountCode, display_order: d.displayOrder, is_active: d.isActive,
    };
    let id = d.id;
    if (id) {
      const r = await sql`update app.claim_categories set code = ${v.code}, name = ${v.name}, claim_group = ${v.claim_group}::app.claim_group, description = ${v.description},
          receipt_required = ${v.receipt_required}, notes_required = ${v.notes_required}, receipt_no_mode = ${v.receipt_no_mode}::app.capture_mode,
          myinvois_uuid_mode = ${v.myinvois_uuid_mode}::app.capture_mode, capture_sst = ${v.capture_sst}, is_mileage = ${v.is_mileage},
          extra_fields = ${v.extra_fields}::app.claim_extra_field[], claimant_scope = ${v.claimant_scope}::app.claimant_scope, min_service_months = ${v.min_service_months},
          eligible_statuses = ${v.eligible_statuses}::app.employment_status[], tax_treatment = ${v.tax_treatment}::app.tax_treatment, ea_form_line = ${v.ea_form_line},
          gl_account_code = ${v.gl_account_code}, display_order = ${v.display_order}, is_active = ${v.is_active}
        where id = ${id}::uuid ${d.version ? sql`and version = ${d.version}` : sql``}`.execute(tx);
      if (!Number(r.numAffectedRows ?? 0)) return fail('This category changed since you opened it — refresh and try again.');
    } else {
      id = (await sql<{ id: string }>`insert into app.claim_categories (code, name, claim_group, description, receipt_required, notes_required, receipt_no_mode,
          myinvois_uuid_mode, capture_sst, is_mileage, extra_fields, claimant_scope, min_service_months, eligible_statuses, tax_treatment, ea_form_line, gl_account_code,
          display_order, is_active)
        values (${v.code}, ${v.name}, ${v.claim_group}::app.claim_group, ${v.description}, ${v.receipt_required}, ${v.notes_required}, ${v.receipt_no_mode}::app.capture_mode,
          ${v.myinvois_uuid_mode}::app.capture_mode, ${v.capture_sst}, ${v.is_mileage}, ${v.extra_fields}::app.claim_extra_field[], ${v.claimant_scope}::app.claimant_scope,
          ${v.min_service_months}, ${v.eligible_statuses}::app.employment_status[], ${v.tax_treatment}::app.tax_treatment, ${v.ea_form_line}, ${v.gl_account_code},
          ${v.display_order}, ${v.is_active}) returning id`.execute(tx)).rows[0]!.id;
    }
    await sql`delete from app.claim_category_grades where category_id = ${id}::uuid and not (grade_id = any(${d.gradeIds}::uuid[]))`.execute(tx);
    for (const g of d.gradeIds) await sql`insert into app.claim_category_grades (category_id, grade_id) values (${id}::uuid, ${g}::uuid) on conflict do nothing`.execute(tx);
    if (d.isMileage && d.mileageRate) {
      const from = d.mileageRateFrom ?? (await todayMyt(tx));
      const cur = (await sql<{ r: string | null }>`select app.claim_rate_on(${id}::uuid, ${from}::date)::text as r`.execute(tx)).rows[0]?.r;
      if (!cur || Number(cur) !== Number(d.mileageRate)) {
        await sql`insert into app.claim_category_rates (category_id, effective_from, rate_per_km) values (${id}::uuid, ${from}::date, ${d.mileageRate}::numeric)
          on conflict (category_id, effective_from) do nothing`.execute(tx);
      }
    }
    await sql`set constraints all immediate`.execute(tx);
    return { id: id!, code: d.code };
  }));
}
export async function setCategoryActive(input: Input): Promise<ActionResult> {
  return act(ADMIN, setCategoryActiveSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = await sql`update app.claim_categories set is_active = ${d.isActive} where id = ${d.id}::uuid`.execute(tx);
    return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
  }));
}
export async function saveLimit(input: Input): Promise<ActionResult<{ id: string }>> {
  return act(ADMIN, saveLimitSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    if (d.id) {
      const r = await sql`update app.claim_limits set per_transaction = ${d.perTransaction}::numeric, per_month = ${d.perMonth}::numeric, per_year = ${d.perYear}::numeric,
          behaviour = ${d.behaviour}::app.limit_behaviour, effective_to = ${d.effectiveTo}::date where id = ${d.id}::uuid`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? { id: d.id } : NOT_FOUND;
    }
    const t = (k: string) => (d.appliesTo === k ? d.targetId : null);
    const id = (await sql<{ id: string }>`insert into app.claim_limits (category_id, applies_to, grade_id, department_id, employee_group_id, employee_id,
        per_transaction, per_month, per_year, behaviour, effective_from, effective_to)
      values (${d.categoryId}::uuid, ${d.appliesTo}::app.limit_applies_to, ${t('grade')}::uuid, ${t('department')}::uuid, ${t('employee_group')}::uuid, ${t('employee')}::uuid,
        ${d.perTransaction}::numeric, ${d.perMonth}::numeric, ${d.perYear}::numeric, ${d.behaviour}::app.limit_behaviour, ${d.effectiveFrom}::date, ${d.effectiveTo}::date)
      returning id`.execute(tx)).rows[0]!.id;
    return { id };
  }));
}
export async function endLimit(input: Input): Promise<ActionResult> {
  return act(ADMIN, endLimitSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = await sql`update app.claim_limits set effective_to = ${d.effectiveTo}::date where id = ${d.id}::uuid and effective_from <= ${d.effectiveTo}::date`.execute(tx);
    return Number(r.numAffectedRows ?? 0) ? {} : fail('The end date must be on or after the effective-from date.', { effectiveTo: 'The end date must be on or after the effective-from date.' });
  }));
}
export async function exportLimitsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return act(ADMIN, limitListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await limitRows(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'claim_limits', recordCount: rows.length });
    return csvFile('claim-limits', ['Category', 'Applies to', 'Target', 'Per transaction (RM)', 'Per month (RM)', 'Per year (RM)', 'Behaviour', 'Effective from', 'Effective to'],
      rows.map((r) => [r.category.name, LIMIT_APPLIES_TO_LABELS[r.appliesTo], r.target?.label ?? 'Everyone', r.perTransaction, r.perMonth, r.perYear,
        LIMIT_BEHAVIOUR_LABELS[r.behaviour], csvDate(r.effectiveFrom), csvDate(r.effectiveTo)]));
  }));
}
export async function updateClaimPolicy(input: Input): Promise<ActionResult> {
  return act(ADMIN, updateClaimPolicySchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`update app.claim_policy set submission_deadline_days = ${d.submissionDeadlineDays}, limit_refresh_day = ${d.limitRefreshDay},
        disbursement_cutoff_day = ${d.disbursementCutoffDay}, notes_required_default = ${d.notesRequiredDefault}, attachments_required_default = ${d.attachmentsRequiredDefault},
        new_claim_reminder_days = ${d.newClaimReminderDays}, include_separated_default = ${d.includeSeparatedDefault},
        autocount_document_date_basis = ${d.autocountDocumentDateBasis} where id = 1`.execute(tx);
    if (d.claimsPayableGl) {
      await sql`insert into app.gl_mappings (purpose, gl_account_code) values ('claims_payable', ${d.claimsPayableGl})
        on conflict (purpose) do update set gl_account_code = excluded.gl_account_code`.execute(tx);
    }
    if (d.saBatchApprovalRequired !== undefined) {
      const isSa = (await sql<{ s: boolean }>`select app.is_sa() as s`.execute(tx)).rows[0]?.s;
      const cur = (await sql<{ s: boolean }>`select sa_batch_approval_required as s from app.security_settings where id = 1`.execute(tx)).rows[0]?.s;
      if (cur !== d.saBatchApprovalRequired) {
        if (!isSa) return fail('Only a Super Admin can change this.', { saBatchApprovalRequired: 'Only a Super Admin can change this.' });
        await sql`update app.security_settings set sa_batch_approval_required = ${d.saBatchApprovalRequired} where id = 1`.execute(tx);
      }
    }
    return {};
  }));
}

// ===========================================================================
// P13 / P14 / C2 — claim form, save, submit, while typing
// ===========================================================================
export async function fetchClaimForm(input: Input): Promise<ActionResult<{ form: ClaimForm | null }>> {
  const s = z.object({ claimNo: z.string().regex(/^CL-[0-9]{4}-[0-9]{5,}$/).optional().catch(undefined), employeeId: uuidSchema.optional().catch(undefined) });
  return act(ANY, s, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => ({ form: await claimFormFor(tx, d.claimNo, d.employeeId) })));
}
export async function saveClaim(input: Input): Promise<ActionResult<SaveClaimResult>> {
  return act(ANY, saveClaimSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, onBehalfEmployeeId: d.employeeId ?? null }, (tx) => saveTx(tx, d)));
}
export async function submitClaim(input: Input): Promise<ActionResult<SubmitClaimResult>> {
  return act(ANY, submitClaimSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const j = (await sql<{ j: R }>`select app.submit_claim(${d.claimId}::uuid, ${d.acknowledgeWarnings}, ${d.expectedVersion ?? null}::int) as j`.execute(tx)).rows[0]!.j;
    return { submitted: !!j.submitted, claimNo: j.claimNo, status: j.status, issues: issuesOf(j.issues), needsAcknowledgement: !!j.needsAcknowledgement, message: j.message };
  }));
}
export async function validateClaim(input: Input): Promise<ActionResult<ValidateClaimResult>> {
  return act(ANY, claimIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const j = (await sql<{ j: R }>`select app.claim_validate(${d.claimId}::uuid) as j`.execute(tx)).rows[0]!.j;
    return { issues: issuesOf(j.issues), lines: (j.lines ?? []).map((l: R) => ({ lineId: l.lineId, lineNo: l.lineNo, limitCheck: l.limitCheck ?? null })) };
  }));
}
export async function deleteClaim(input: Input): Promise<ActionResult> {
  return act(ANY, claimIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.delete_claim(${d.claimId}::uuid)`.execute(tx);
    return {};
  }));
}
export async function checkClaimLine(input: Input): Promise<ActionResult<ClaimLineCheck>> {
  return act(ANY, checkClaimLineSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const p = { employeeId: d.employeeId ?? null, claimId: d.claimId ?? null, lineId: d.lineId ?? null, categoryId: d.categoryId, transactionDate: d.transactionDate,
      amountInclSst: d.amountInclSst, distanceKm: d.distanceKm ?? null, receiptNo: d.receiptNo, myinvoisUuid: d.myinvoisUuid, merchant: d.merchant, otherLines: d.otherLines };
    const j = (await sql<{ j: R }>`select app.claim_line_preview(${JSON.stringify(p)}::jsonb) as j`.execute(tx)).rows[0]!.j;
    return { limit: j.limit ?? null, deadline: j.deadline, duplicate: j.duplicate ?? null, uuidClash: j.uuidClash ?? null,
      mileage: j.mileage && j.mileage.amount ? { ratePerKm: j.mileage.ratePerKm, amount: j.mileage.amount } : null };
  }));
}
export async function fetchMileageAmount(input: Input): Promise<ActionResult<MileageAmountResult>> {
  return act(ANY, mileageAmountSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const r = (await sql<{ r: string | null }>`select app.claim_rate_on(${d.categoryId}::uuid, ${d.transactionDate}::date)::text as r`.execute(tx)).rows[0]?.r ?? null;
    if (!r) return fail('No mileage rate is set for this date — contact HR.', { transactionDate: 'No mileage rate is set for this date — contact HR.' });
    const rate = Number(r).toFixed(3);
    return { ratePerKm: rate, amount: mileageAmount(d.distanceKm, rate), rateLabel: `RM ${rate}/km` };
  }));
}
export async function fetchClaimApproverHint(input: Input): Promise<ActionResult<{ hint: string | null }>> {
  return act(ANY, approverHintSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const emp = d.employeeId ?? (await myEmployeeId(tx));
    if (!emp) return { hint: null };
    return { hint: (await sql<{ h: string | null }>`select app.claim_approver_hint(${emp}::uuid) as h`.execute(tx)).rows[0]?.h ?? null };
  }));
}
export async function searchClaimEmployees(input: Input): Promise<ActionResult<{ rows: ClaimEmployeeOption[] }>> {
  return act(ADMIN, claimEmployeeOptionsSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    return claimEmployeeOptions(tx, d);
  }));
}

// receipts (CLN15)
export async function requestClaimUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return act(ANY, requestClaimUploadSchema, input, async (d, { ctx, accessToken }) => {
    const info = await withUserTx(ctx, async (tx) => ({
      emp: d.employeeId ?? (await myEmployeeId(tx)),
      medical: d.categoryId ? (await sql<{ g: string }>`select claim_group::text as g from app.claim_categories where id = ${d.categoryId}::uuid`.execute(tx)).rows[0]?.g === 'medical' : false,
    }));
    if (!info.emp) return fail('Your employee record has not been created yet.');
    return requestUpload(ctx, accessToken, { subject: 'claim_receipt', ownerEmployeeId: info.emp, scope: 'receipts', originalName: d.fileName, mimeType: d.mimeType,
      sizeBytes: d.sizeBytes, dataCategory: info.medical ? 'health' : null });
  });
}
export async function confirmClaimUpload(input: Input): Promise<ActionResult<{ fileId: string }>> {
  return act(ANY, fileIdSchema, input, async (d, { ctx, accessToken }) => {
    await confirmUpload(ctx, accessToken, d.fileId);
    return { fileId: d.fileId };
  });
}
export async function getClaimReceiptUrl(input: Input): Promise<ActionResult<DownloadUrl>> {
  return act(ANY, claimReceiptUrlSchema, input, async (d, { ctx, accessToken }) => {
    const ok = await withUserTx(ctx, async (tx) => (await sql<{ id: string }>`select lf.file_id as id from app.claim_line_files lf join app.claim_lines l on l.id = lf.claim_line_id
        where lf.file_id = ${d.fileId}::uuid and l.claim_id = ${d.claimId}::uuid`.execute(tx)).rows[0]);
    if (!ok) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, d.fileId, { purpose: 'view' });
  });
}

// P12 / P15 / P29
export async function withdrawClaim(input: Input): Promise<ActionResult> {
  return act(ANY, claimIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => { await sql`select app.withdraw_claim(${d.claimId}::uuid)`.execute(tx); return {}; }));
}
export async function copyClaim(input: Input): Promise<ActionResult<{ id: string; claimNo: string }>> {
  return act(ANY, copyClaimSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const j = (await sql<{ j: R }>`select app.copy_claim(${d.claimId}::uuid, ${d.idempotencyKey}::uuid) as j`.execute(tx)).rows[0]!.j;
    return { id: j.id, claimNo: j.claimNo };
  }));
}
export async function cancelClaim(input: Input): Promise<ActionResult> {
  return act(TEAM, cancelClaimSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
    await sql`select app.cancel_claim(${d.claimId}::uuid, ${d.reason})`.execute(tx); return {};
  }));
}
export async function undoDisbursement(input: Input): Promise<ActionResult> {
  return act(ADMIN, undoDisbursementSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
    await sql`select app.undo_claim_disbursement(${d.claimId}::uuid, ${d.reason})`.execute(tx); return {};
  }));
}
export async function exportMyClaimsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return act(ANY, myClaimsParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await myClaimRows(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'my_claims', recordCount: rows.length });
    return csvFile('my-claims', ['Claim no.', 'Title', 'Lines', 'Total (RM)', 'SST (RM)', 'Status', 'Flags', 'Submitted', 'Disbursed on', 'Payment reference'],
      rows.map((r) => [r.claimNo, r.title, r.lineCount, r.total, r.totalSst, CLAIM_STATUS_LABELS[r.status], r.flags.map((f) => CLAIM_FLAG_LABELS[f]).join('; '),
        csvDateTime(r.submittedAt), csvDate(r.disbursedOn), r.paymentReference]));
  }));
}

// ===========================================================================
// C1 exports (CSV: MGR team scope; .xlsx: ADM/SA)
// ===========================================================================
async function claimExportTable(tx: Tx, p: z.output<typeof claimListParamsSchema>, scope: 'all' | 'team') {
  const page = await claimListPage(tx, p, true, scope);
  if (page.view === 'line') {
    return { page, headers: ['Employee no.', 'Employee', 'Department', 'Date of transaction', 'Date of application', 'Category', 'Claim no.', 'Line', 'Mileage (km)', 'Description',
      'Amount (RM)', 'SST (RM)', 'Attachments', 'Receipt / e-Invoice no.', 'UUID', 'Date of approval / rejection', 'Approved / rejected by', 'Status', 'Batch', 'Disbursed on'],
      rows: page.rows.map((r) => [r.employee.employeeNo, r.employee.name, r.department, csvDate(r.transactionDate), csvDate(r.submittedAt), r.category.name, r.claimNo, r.lineNo,
        r.distanceKm, r.description, r.amountInclSst, r.sstAmount, r.attachmentCount, r.receiptNo, r.myinvoisUuid, csvDateTime(r.decidedAt), r.decidedByName,
        CLAIM_STATUS_LABELS[r.status], r.batchNo, csvDate(r.disbursedOn)]) };
  }
  return { page, headers: ['Claim no.', 'Employee no.', 'Employee', 'Department', 'Title', 'Lines', 'Total (RM)', 'SST (RM)', 'Status', 'Flags', 'Submitted', 'Approved / rejected by',
    'Decided at', 'Batch', 'Disbursed on', 'Payment reference'],
    rows: page.rows.map((r) => [r.claimNo, r.employee.employeeNo, r.employee.name, r.department, r.title, r.lineCount, r.total, r.totalSst, CLAIM_STATUS_LABELS[r.status],
      r.flags.map((f) => CLAIM_FLAG_LABELS[f]).join('; '), csvDateTime(r.submittedAt), r.decidedByName, csvDateTime(r.decidedAt), r.batchNo, csvDate(r.disbursedOn), r.paymentReference]) };
}
export async function exportClaimsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return act(TEAM, claimListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const scope = (await dbIsAdmin(tx)) ? 'all' : 'team';
    const t = await claimExportTable(tx, p, scope);
    await writeAccess(tx, { action: 'export', entityType: scope === 'all' ? 'claims' : 'team_claims', recordCount: t.rows.length });
    return csvFile(scope === 'all' ? 'claims' : 'team-claims', t.headers, t.rows);
  }));
}
export async function exportClaimsXlsx(params: Input): Promise<ActionResult<DownloadUrl>> {
  return act(ADMIN, claimListParamsSchema, params, async (p, { ctx, accessToken }) => {
    const t = await withUserTx(ctx, async (tx) => {
      const x = await claimExportTable(tx, p, 'all');
      await writeAccess(tx, { action: 'export', entityType: 'claims_xlsx', recordCount: x.rows.length });
      return x;
    });
    const layout = { code: 'claims_list', version: 1, columns: t.headers.map((h, i) => ({ key: String(i), header: h, format: /\(RM\)$/.test(h) ? 'money' as const : 'text' as const,
      width: Math.max(10, Math.min(40, h.length + 6)), value: (r: unknown) => (r as (string | number | null)[])[i] ?? null })) };
    const bytes = await renderXlsx([{ name: 'Claims', layout, rows: t.rows } as SheetSpec<unknown>], { title: 'PRET claims', creator: 'PRET' });
    const name = `claims-${csvDate(await withUserTx(ctx, todayMyt)).replace(/\//g, '-')}.xlsx`;
    const f = await storeGeneratedFile(ctx, accessToken, { scope: `claims/${randomUUID()}`, fileName: name, mimeType: XLSX_MIME, bytes });
    await withUserTx(ctx, (tx) => sql`select app.record_export('report_xlsx', 'claims_filter', null, ${f.fileId}::uuid, ${t.rows.length}, null, ${f.sha256}, 'claims_list')`.execute(tx));
    return getDownloadUrl(ctx, accessToken, f.fileId, { purpose: 'download' });
  });
}

// ===========================================================================
// C3 bulk entry (Could): rows with the same employee + title form one claim; each saved on behalf and submitted
// ===========================================================================
function bulkGroups(rows: z.output<typeof bulkClaimsSchema>['rows']) {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.employeeId}|${r.title.trim().toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.values()];
}
function bulkPayload(g: z.output<typeof bulkClaimsSchema>['rows'], key: string): z.output<typeof saveClaimSchema> {
  return {
    employeeId: g[0]!.employeeId, onBehalfNote: 'Bulk claim entry', title: g[0]!.title, projectRef: null, idempotencyKey: key, claimId: undefined, expectedVersion: undefined,
    lines: g.map((r) => ({ id: undefined, categoryId: r.categoryId, transactionDate: r.transactionDate, description: r.description, merchant: r.merchant, receiptNo: r.receiptNo,
      myinvoisUuid: r.myinvoisUuid, amountInclSst: r.amountInclSst, sstAmount: r.sstAmount, fromPlace: r.fromPlace, toPlace: r.toPlace, purpose: r.purpose,
      distanceKm: r.distanceKm, clientAttendees: null, travelDestination: null, claimant: 'self' as const, dependantName: null, costCentreId: null, fileIds: r.fileIds })),
  };
}
function stableKey(base: string, i: number): string {
  const hex = Buffer.from(`${base}:${i}`).toString('hex').padEnd(32, '0').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function validateBulkClaims(input: Input): Promise<ActionResult<BulkClaimPreview>> {
  return act(ADMIN, bulkClaimsSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const out: BulkClaimPreview['rows'] = [];
    for (const g of bulkGroups(d.rows)) {
      await sql`savepoint bulk_check`.execute(tx);
      try {
        const s = await saveTx(tx, bulkPayload(g, randomUUID()));
        const j = (await sql<{ j: R }>`select app.claim_validate(${s.id}::uuid) as j`.execute(tx)).rows[0]!.j;
        const blocks = issuesOf(j.issues).filter((i) => i.severity === 'block');
        g.forEach((r, i) => {
          const mine = blocks.filter((b) => b.lineNo === i + 1 || b.lineNo === null);
          out.push({ rowNo: r.rowNo, ok: mine.length === 0, message: mine.map((b) => b.message).join(' · ') || null });
        });
      } catch (e) {
        const f = fieldFail(e);
        g.forEach((r) => out.push({ rowNo: r.rowNo, ok: false, message: f.ok === false ? f.error : 'Invalid' }));
      }
      await sql`rollback to savepoint bulk_check`.execute(tx);
    }
    out.sort((a, b) => a.rowNo - b.rowNo);
    return { rows: out, claims: bulkGroups(d.rows).length, errors: out.filter((r) => !r.ok).length };
  }));
}
export async function submitBulkClaims(input: Input): Promise<ActionResult<BulkClaimResult>> {
  return act(ADMIN, bulkClaimsSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const claims: BulkClaimResult['claims'] = [];
    let i = 0;
    for (const g of bulkGroups(d.rows)) {
      i += 1;
      const emp = (await sql<R>`select id, employee_no, full_name, preferred_name from app.employees where id = ${g[0]!.employeeId}::uuid`.execute(tx)).rows[0];
      const who = emp ? personRef(emp.id, emp.employee_no, emp.full_name, emp.preferred_name) : { id: g[0]!.employeeId, employeeNo: null, name: '' };
      await sql`savepoint bulk_submit`.execute(tx);
      try {
        const s = await saveTx(tx, bulkPayload(g, stableKey(d.idempotencyKey, i)));
        const j = s.duplicate ? { submitted: true, message: 'Already submitted' } : (await sql<{ j: R }>`select app.submit_claim(${s.id}::uuid, true, null) as j`.execute(tx)).rows[0]!.j;
        if (!j.submitted) {
          await sql`rollback to savepoint bulk_submit`.execute(tx);
          claims.push({ claimNo: null, employee: who, lines: g.length, total: sumMoney(g.map((r) => r.amountInclSst)), ok: false,
            result: issuesOf(j.issues).filter((x) => x.severity === 'block').map((x) => `Line ${x.lineNo ?? '-'}: ${x.message}`).join(' · ') || 'Not submitted' });
          continue;
        }
        await sql`release savepoint bulk_submit`.execute(tx);
        claims.push({ claimNo: s.claimNo, employee: who, lines: g.length, total: s.totals.total, ok: true, result: 'Submitted' });
      } catch (e) {
        await sql`rollback to savepoint bulk_submit`.execute(tx);
        const f = fieldFail(e);
        claims.push({ claimNo: null, employee: who, lines: g.length, total: sumMoney(g.map((r) => r.amountInclSst)), ok: false, result: f.ok === false ? f.error : 'Failed' });
      }
    }
    return { claims, created: claims.filter((c) => c.ok).length, failed: claims.filter((c) => !c.ok).length };
  }));
}

// ===========================================================================
// C4 late overrides
// ===========================================================================
export async function fetchLateOverrideCandidates(input: Input): Promise<ActionResult<{ rows: LateOverrideCandidate[] }>> {
  return act(ADMIN, lateOverrideCandidatesSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    return lateOverrideCandidates(tx, d);
  }));
}
export async function applyLateOverride(input: Input): Promise<ActionResult<{ lines: number }>> {
  return act(ADMIN, applyLateOverrideSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => ({
    lines: (await sql<{ n: number }>`select app.apply_late_override(${d.employeeId}::uuid, ${d.lineIds}::uuid[], ${d.reason}) as n`.execute(tx)).rows[0]!.n,
  })));
}
export async function exportLateOverridesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return act(ADMIN, lateOverrideListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await lateOverrideRows(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'claim_late_overrides', recordCount: rows.length });
    return csvFile('late-submission-overrides', ['Employee no.', 'Employee', 'Claim no.', 'Line', 'Transaction date', 'Days past deadline', 'Reason', 'Applied by', 'Applied at', 'Used'],
      rows.map((r) => [r.employee.employeeNo, r.employee.name, r.claimNo, r.lineNo, csvDate(r.transactionDate), r.daysPastDeadline, r.reason, r.appliedByName, csvDateTime(r.appliedAt), r.used]));
  }));
}

// ===========================================================================
// C9 / C10 / C11 / C13 batches
// ===========================================================================
export async function exportBatchesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return act(ADMIN, batchListParamsSchema, params, async (p, { ctx }) => withUserTx(ctx, async (tx) => {
    const { rows } = await batchRows(tx, p, true);
    await writeAccess(tx, { action: 'export', entityType: 'disbursement_batches', recordCount: rows.length });
    return csvFile('disbursement-batches', ['Batch no.', 'Disbursement month', 'Approval cut-off', 'Claims', 'Total (RM)', 'SST (RM)', 'Status', 'Payment date', 'Payment reference',
      'Prepared by', 'Approved by', 'Outputs'],
      rows.map((r) => [r.batchNo, monthLabel(r.disbursementMonth, true), csvDate(r.cutoffDate), r.claimCount, r.total, r.totalSst, BATCH_STATUS_LABELS[r.status], csvDate(r.paymentDate),
        r.paymentReference, r.preparedByName, r.approvedByName, r.outputs === 'current' ? 'Current' : r.outputs === 'out_of_date' ? 'Out of date' : '']));
  }));
}
export async function fetchBatchDefaults(input: Input): Promise<ActionResult<BatchDefaults>> {
  return act(ADMIN, batchDefaultsSchema, input, async (d, { ctx }) => withUserTx(ctx, (tx) => batchDefaults(tx, d.disbursementMonth)));
}
export async function fetchBatchCandidates(input: Input): Promise<ActionResult<BatchCandidates>> {
  return act(ADMIN, batchCandidatesSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    return batchCandidates(tx, d);
  }));
}
export async function previewBatch(input: Input): Promise<ActionResult<BatchPreview>> {
  return act(ADMIN, batchPreviewSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    return batchPreview(tx, d);
  }));
}
export async function createBatch(input: Input): Promise<ActionResult<CreateBatchResult>> {
  return act(ADMIN, createBatchSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const j = (await sql<{ j: R }>`select app.create_batch(${JSON.stringify(d)}::jsonb) as j`.execute(tx)).rows[0]!.j;
    return { id: j.id, batchNo: j.batchNo, duplicate: !!j.duplicate };
  }));
}
export async function addBatchClaims(input: Input): Promise<ActionResult> {
  return act(ADMIN, batchClaimsChangeSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.batch_add_claims(${d.batchId}::uuid, ${d.claimIds}::uuid[], ${d.expectedVersion ?? null}::int)`.execute(tx); return {};
  }));
}
export async function removeBatchClaim(input: Input): Promise<ActionResult> {
  return act(ADMIN, removeBatchClaimSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    await sql`select app.batch_remove_claim(${d.batchId}::uuid, ${d.claimId}::uuid, ${d.expectedVersion ?? null}::int)`.execute(tx); return {};
  }));
}
export async function submitBatchForApproval(input: Input): Promise<ActionResult> {
  return act(ADMIN, batchIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => { await sql`select app.batch_submit_for_approval(${d.batchId}::uuid)`.execute(tx); return {}; }));
}
export async function markBatchDisbursed(input: Input): Promise<ActionResult<MarkBatchDisbursedResult>> {
  return act(ADMIN, markBatchDisbursedSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const j = (await sql<{ j: R }>`select app.mark_batch_disbursed(${d.batchId}::uuid, ${d.paymentDate}::date, ${d.paymentReference}, ${d.notes}, ${d.expectedVersion ?? null}::int) as j`.execute(tx)).rows[0]!.j;
    return { claims: j.claims, employees: j.employees, total: j.total };
  }));
}
export async function cancelBatch(input: Input): Promise<ActionResult> {
  return act(ADMIN, cancelBatchSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
    await sql`select app.cancel_batch(${d.batchId}::uuid, ${d.reason})`.execute(tx); return {};
  }));
}
export async function exportBatchClaimsCsv(input: Input): Promise<ActionResult<CsvFile>> {
  return act(ADMIN, batchIdSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const b = (await sql<R>`select batch_no from app.disbursement_batches where id = ${d.batchId}::uuid`.execute(tx)).rows[0];
    if (!b) return NOT_FOUND;
    const payees = await payeesOf(tx, d.batchId);
    await writeAccess(tx, { action: 'export', entityType: 'disbursement_batch_claims', entityId: d.batchId, recordCount: payees.length });
    return csvFile(`batch-${b.batch_no}`, ['Employee no.', 'Employee', 'Claims', 'Claim nos.', 'Amount (RM)', 'Pay by', 'Bank', 'Account', 'Bank details complete'],
      payees.map(payeeRow).map((p) => [p.employee.employeeNo, p.employee.name, p.claimCount, p.claimNos.join(' '), p.amount, p.paymentMethod ?? 'None', p.bankName, p.accountMasked, p.bankComplete]));
  }));
}

// ---------------------------------------------------------------------------
// Outputs: HLB payment list (.xlsx + PDF) and AutoCount postings (.xlsx) — C11 GENERATE OUTPUTS / C12 / C15
// ---------------------------------------------------------------------------
function autocountSheet(rows: PostingRow[]): SheetSpec<PostingRow> {
  return { name: 'AutoCount postings', layout: AUTOCOUNT_CLAIMS_LAYOUT, rows,
    totals: { amountExclSst: columnTotal(AUTOCOUNT_CLAIMS_LAYOUT, rows, 'amountExclSst'), sst: columnTotal(AUTOCOUNT_CLAIMS_LAYOUT, rows, 'sst'),
      amountInclSst: columnTotal(AUTOCOUNT_CLAIMS_LAYOUT, rows, 'amountInclSst') } };
}
export async function generateBatchOutputs(input: Input): Promise<ActionResult<GenerateOutputsResult>> {
  return act(ADMIN, batchIdSchema, input, async (d, { ctx, accessToken }) => {
    const built = await withUserTx({ ...ctx, reason: 'HLB payment list generation' }, async (tx) => {
      const b = (await sql<R>`select b.*, b.status::text as status, app.user_name(b.prepared_by) as prep, app.user_name(b.approved_by) as appr
          from app.disbursement_batches b where b.id = ${d.batchId}::uuid`.execute(tx)).rows[0];
      if (!b) return NOT_FOUND;
      const payees = await payeesOf(tx, b.id);
      const incomplete = payees.filter((p) => p.paymentMethod === 'bank_transfer' && !p.bankComplete);
      if (incomplete.length) return fail(`Employees with incomplete bank details: ${incomplete.map((p) => `${p.employeeNo} ${p.fullName}`).join(', ')}.`);
      const pol = (await sql<R>`select autocount_document_date_basis as basis from app.claim_policy where id = 1`.execute(tx)).rows[0]!;
      const credit = (await sql<{ g: string | null }>`select gl_account_code as g from app.gl_mappings where purpose = 'claims_payable'`.execute(tx)).rows[0]?.g ?? null;
      const posting = buildPostingRows(await postingLines(tx, sql`l.claim_id in (select m.claim_id from app.disbursement_batch_claims m where m.batch_id = ${b.id}::uuid and m.removed_at is null)`),
        { basis: pol.basis, creditAccount: credit });
      if (posting.missingGl.length) return fail(`Category without GL account: ${posting.missingGl.join(', ')}.`);
      // brief rule 4: app.payment_list_view writes the access-log row (export, bank) BEFORE any account number is decrypted
      const unreadable = await decryptPayees(tx, b.id, payees, 'export');
      if (unreadable.length) return fail(`The bank account of ${unreadable.join(', ')} could not be read — re-enter it on the Bank tab.`);
      const list = buildPaymentList(payees, { batchNo: b.batch_no, disbursementMonth: b.disbursement_month, total: m2(b.total_amount) });
      if (!list.totals.matches) return fail(`The payment list total does not equal the batch total (${rmPlain(b.total_amount)}).`);
      const co = (await sql<R>`select p.legal_name, s.hlb_account_no_last4 from app.company_profile p left join app.company_statutory s on true limit 1`.execute(tx)).rows[0] ?? {};
      return { b, list, posting: posting.rows, co, version: b.outputs_version + 1 };
    });
    if ('ok' in built) return built;
    const { b, list, posting, co, version } = built;
    const header: [string, string][] = [
      ['Company', co.legal_name ?? 'Interact Technology Sdn Bhd'], ['Paying account', `Hong Leong Bank ${co.hlb_account_no_last4 ? `••••${co.hlb_account_no_last4}` : '(not set)'}`],
      ['Batch no.', b.batch_no], ['Disbursement month', monthLabel(b.disbursement_month, true)], ['Planned payment date', csvDate(b.planned_payment_date)],
      ['Count', String(b.claim_count)], ['Total (RM)', rmPlain(b.total_amount)], ['Prepared by / at', `${b.prep ?? ''} · ${csvDateTime(b.created_at)}`],
      ...(b.approved_by ? [['Approved by / at', `${b.appr ?? ''} · ${csvDateTime(b.approved_at)}`] as [string, string]] : []),
      ['Version', String(version)], ['Generated', csvDateTime(new Date().toISOString())],
    ];
    const hlbTotals = { amount: list.totals.hlb };
    const ccTotals = { amount: list.totals.chequeCash };
    const hlbXlsx = await renderXlsx([
      { name: 'HLB payment list', header, layout: HLB_PAYMENT_LIST_LAYOUT, rows: list.rows, totals: hlbTotals, totalsLabel: 'Total (HLB)' } as SheetSpec<unknown>,
      { name: 'Pay by cheque or cash', header: [['Note', 'Excluded from the HLB list (D23)']], layout: CHEQUE_CASH_LAYOUT, rows: list.chequeCash, totals: ccTotals, totalsLabel: 'Total (cheque / cash)' } as SheetSpec<unknown>,
    ], { title: `HLB payment list ${b.batch_no}`, creator: 'PRET' });
    const hlbPdf = await renderTablePdf({ title: `Claims reimbursement payment list — ${b.batch_no}`, header, banner: HLB_MANUAL_BANNER, footer: `${b.batch_no} · v${version} · CONFIDENTIAL` }, [
      { title: 'HLB Connect First payment list', layout: HLB_PAYMENT_LIST_LAYOUT, rows: list.rows, totals: hlbTotals, totalsLabel: 'Total (HLB)' } as never,
      { title: 'Pay by cheque or cash (excluded from the HLB list — D23)', layout: CHEQUE_CASH_LAYOUT, rows: list.chequeCash, totals: ccTotals, totalsLabel: 'Total (cheque / cash)', emptyText: 'No cheque / cash payees.' } as never,
    ]);
    const acXlsx = await renderXlsx([autocountSheet(posting) as SheetSpec<unknown>], { title: `AutoCount claims postings ${b.batch_no}`, creator: 'PRET' });
    const scope = `hlb/${b.id}/v${version}`;
    const f1 = await storeGeneratedFile(ctx, accessToken, { scope, fileName: `${b.batch_no}-HLB-payment-list-v${version}.xlsx`, mimeType: XLSX_MIME, bytes: hlbXlsx, dataCategory: 'bank' });
    const f2 = await storeGeneratedFile(ctx, accessToken, { scope, fileName: `${b.batch_no}-HLB-payment-list-v${version}.pdf`, mimeType: PDF_MIME, bytes: hlbPdf, dataCategory: 'bank' });
    const f3 = await storeGeneratedFile(ctx, accessToken, { scope, fileName: `${b.batch_no}-AutoCount-postings-v${version}.xlsx`, mimeType: XLSX_MIME, bytes: acXlsx });
    const files = [
      { kind: 'hlb_claims_payment_list_xlsx', fileId: f1.fileId, sha256: f1.sha256, rowCount: list.rows.length, total: list.totals.hlb, layoutCode: HLB_PAYMENT_LIST_LAYOUT.code, layoutVersion: HLB_PAYMENT_LIST_LAYOUT.version },
      { kind: 'hlb_claims_payment_list_pdf', fileId: f2.fileId, sha256: f2.sha256, rowCount: list.rows.length, total: list.totals.hlb, layoutCode: HLB_PAYMENT_LIST_LAYOUT.code, layoutVersion: HLB_PAYMENT_LIST_LAYOUT.version },
      { kind: 'autocount_claims_xlsx', fileId: f3.fileId, sha256: f3.sha256, rowCount: posting.length, total: columnTotal(AUTOCOUNT_CLAIMS_LAYOUT, posting, 'amountInclSst'), layoutCode: AUTOCOUNT_CLAIMS_LAYOUT.code, layoutVersion: AUTOCOUNT_CLAIMS_LAYOUT.version },
    ];
    const r = await withUserTx(ctx, async (tx) => (await sql<{ j: R }>`select app.record_batch_outputs(${b.id}::uuid, ${JSON.stringify(files)}::jsonb,
        ${list.totals.hlb}::numeric, ${list.totals.chequeCash}::numeric) as j`.execute(tx)).rows[0]!.j);
    const out = await withUserTx(ctx, async (tx) => (await sql<R>`select x.id, x.kind::text as kind, f.original_name, x.row_count, x.total_amount
        from app.export_files x join app.files f on f.id = x.file_id where x.subject_type = 'disbursement_batch' and x.subject_id = ${b.id}::uuid and x.version = ${r.version}
        order by x.kind`.execute(tx)).rows);
    return { version: r.version, status: r.status,
      files: out.map((x) => ({ exportFileId: x.id, kind: x.kind as OutputKind, fileName: x.original_name, rowCount: x.row_count, total: x.total_amount === null ? null : m2(x.total_amount) })) };
  });
}
export async function fetchPaymentListReport(input: Input): Promise<ActionResult<{ report: PaymentListReport | null }>> {
  return act(ADMIN, paymentListReportSchema, input, async (d, { ctx }) => withUserTx({ ...ctx, reason: 'HLB payment list viewed (C12)' }, async (tx) => ({
    report: await paymentListReport(tx, d.batchNo),
  })));
}
export async function getExportFileUrl(input: Input): Promise<ActionResult<DownloadUrl>> {
  return act(ADMIN, exportFileUrlSchema, input, async (d, { ctx, accessToken }) => {
    const f = await withUserTx(ctx, async (tx) => (await sql<{ file_id: string }>`select file_id from app.export_files where id = ${d.exportFileId}::uuid`.execute(tx)).rows[0]);
    if (!f) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, f.file_id, { purpose: 'download' });
  });
}

// C15 AutoCount (date range or batch)
function autocountWhere(d: z.output<typeof autocountExportSchema>, basis: 'approval' | 'disbursed') {
  const st = sql`c.status::text = any(${d.statuses}::text[])`;
  if (d.source === 'batch') return sql`${st} and c.id in (select m.claim_id from app.disbursement_batch_claims m where m.batch_id = ${d.batchId!}::uuid and m.removed_at is null)`;
  const dateCol = basis === 'disbursed' ? sql`coalesce(c.disbursed_on, (c.decided_at at time zone 'Asia/Kuala_Lumpur')::date)` : sql`(c.decided_at at time zone 'Asia/Kuala_Lumpur')::date`;
  return sql`${st} and ${dateCol} between ${d.from!}::date and ${d.to!}::date`;
}
async function autocountBuild(tx: Tx, d: z.output<typeof autocountExportSchema>) {
  const pol = (await sql<R>`select autocount_document_date_basis as basis from app.claim_policy where id = 1`.execute(tx)).rows[0]!;
  const credit = (await sql<{ g: string | null }>`select gl_account_code as g from app.gl_mappings where purpose = 'claims_payable'`.execute(tx)).rows[0]?.g ?? null;
  const lines = await postingLines(tx, autocountWhere(d, pol.basis));
  const built = buildPostingRows(lines, { basis: pol.basis, creditAccount: credit });
  const blocked = (await sql<R>`select id, code, name from app.claim_categories where name = any(${built.missingGl}::text[])`.execute(tx)).rows;
  return { built, basis: pol.basis as 'approval' | 'disbursed', credit, blocked };
}
export async function previewAutocountExport(input: Input): Promise<ActionResult<AutocountPreview>> {
  return act(ADMIN, autocountExportSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const x = await autocountBuild(tx, d);
    return { rowCount: x.built.rows.length, total: columnTotal(AUTOCOUNT_CLAIMS_LAYOUT, x.built.rows, 'amountInclSst'), documentDateBasis: x.basis,
      blocked: x.blocked.map((k) => ({ categoryId: k.id, code: k.code, name: k.name })), creditAccount: x.credit, columns: AUTOCOUNT_CLAIMS_LAYOUT.columns.map((c) => c.header) };
  }));
}
export async function exportAutocount(input: Input): Promise<ActionResult<DownloadUrl & { rowCount: number }>> {
  return act(ADMIN, autocountExportSchema, input, async (d, { ctx, accessToken }) => {
    const x = await withUserTx(ctx, async (tx) => {
      const r = await autocountBuild(tx, d);
      await writeAccess(tx, { action: 'export', entityType: 'autocount_claims', entityId: d.batchId ?? null, recordCount: r.built.rows.length });
      return r;
    });
    if (x.built.missingGl.length) return fail(`Category without GL account: ${x.built.missingGl.join(', ')}.`);
    if (x.built.rows.length === 0) return fail('No approved or disbursed claims match.');
    const bytes = await renderXlsx([autocountSheet(x.built.rows) as SheetSpec<unknown>], { title: 'AutoCount claims postings', creator: 'PRET' });
    const name = d.source === 'batch' ? `AutoCount-postings-${x.built.rows[0]?.batchNo ?? 'batch'}.xlsx` : `AutoCount-postings-${csvDate(d.from!).replace(/\//g, '-')}-to-${csvDate(d.to!).replace(/\//g, '-')}.xlsx`;
    const f = await storeGeneratedFile(ctx, accessToken, { scope: `autocount/${randomUUID()}`, fileName: name, mimeType: XLSX_MIME, bytes });
    await withUserTx(ctx, (tx) => sql`select app.record_export('autocount_claims_xlsx', 'claims_range', ${d.batchId ?? null}::uuid, ${f.fileId}::uuid, ${x.built.rows.length},
      ${columnTotal(AUTOCOUNT_CLAIMS_LAYOUT, x.built.rows, 'amountInclSst')}::numeric, ${f.sha256}, ${AUTOCOUNT_CLAIMS_LAYOUT.code})`.execute(tx));
    const u = await getDownloadUrl(ctx, accessToken, f.fileId, { purpose: 'download' });
    return { ...u, rowCount: x.built.rows.length };
  });
}

// C16 attachment bundle
export async function previewAttachmentBundle(input: Input): Promise<ActionResult<AttachmentBundlePreview>> {
  return act(ADMIN, attachmentBundleSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => {
    const x = await bundleFiles(tx, d);
    const bytes = x.files.reduce((a, f) => a + Number(f.size_bytes), 0);
    return { files: x.files.length, claims: x.claims, totalBytes: bytes, tooLarge: bytes > BUNDLE_MAX_BYTES || x.files.length > BUNDLE_MAX_FILES,
      limitNote: `Up to ${BUNDLE_MAX_FILES} files and 9.5 MB per zip — narrow the filter for larger sets.` };
  }));
}
export async function downloadAttachmentBundle(input: Input): Promise<ActionResult<AttachmentBundleResult>> {
  return act(ADMIN, attachmentBundleSchema, input, async (d, { ctx, accessToken }) => {
    const x = await withUserTx(ctx, (tx) => bundleFiles(tx, d));
    if (x.files.length === 0) return fail('There are no receipts to download.');
    const bytes = x.files.reduce((a, f) => a + Number(f.size_bytes), 0);
    if (bytes > BUNDLE_MAX_BYTES || x.files.length > BUNDLE_MAX_FILES) return fail(`Too many receipts for one zip (${x.files.length} files). Narrow the filter.`);
    const { read } = await readFilesForBundle({ ...ctx, reason: 'Attachment bundle' }, accessToken, x.files.map((f) => f.id));
    const entries = read.map((f) => { const m = x.files.find((y) => y.id === f.id)!; return { name: bundleEntryName(m.claim_no, m.line_no, m.n, m.original_name, m.mime_type), bytes: f.bytes }; });
    const zip = await renderZip(entries);
    const health = x.files.some((f) => f.cat === 'health');
    const today = await withUserTx(ctx, todayMyt);
    const name = `claims-receipts-${csvDate(today).replace(/\//g, '-')}.zip`;
    const f = await storeGeneratedFile(ctx, accessToken, { scope: `bundles/${randomUUID()}`, fileName: name, mimeType: ZIP_MIME, bytes: zip, dataCategory: health ? 'health' : null });
    await withUserTx(ctx, (tx) => sql`select app.record_export('attachment_bundle_zip', 'claims_filter', ${d.batchId ?? null}::uuid, ${f.fileId}::uuid, ${entries.length}, null, ${f.sha256})`.execute(tx));
    const u = await getDownloadUrl(ctx, accessToken, f.fileId, { purpose: 'download' });
    return { ...u, files: entries.length, claims: x.claims };
  });
}

// E3 profile Claims tab (year / status selector)
export async function fetchEmployeeClaimsTab(input: Input): Promise<ActionResult<{ tab: EmployeeClaimsTab | null }>> {
  const s = employeeClaimsParamsSchema.extend({ employeeId: uuidSchema });
  return act(ADMIN, s, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => ({ tab: await employeeClaimsTab(tx, d.employeeId, d) })));
}
