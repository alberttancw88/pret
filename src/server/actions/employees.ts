'use server';

// M1 Employee master Server Actions (W2-003). Contract: src/server/contracts/employees.ts (function register).
// Each action: requireUser([...roles]) → zod → withUserTx (RLS + DB guards: self-edit guard, reporting-line
// guard, status model, no self-decision) → audit (DB trigger) / access log (exports, reveals, downloads) → ActionResult.
// Sensitive identifiers are encrypted here (ADR-0003) before they reach the database and are decrypted only
// after the access-log row is written (revealEmployeeValue / revealMyValue / revealChangeRequestValue).

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { writeAccess } from '../audit';
import { fieldCrypto, protectIdentifier, type FieldRef } from '../crypto';
import { confirmUpload, getDownloadUrl, requestUpload } from '../storage';
import { fail, hasRole, NO_ACCESS, runAction, type Input } from '../lib/action-helpers';
import { csvDate, csvDateTime, csvFile } from '../lib/csv';
import { companyName, createEmployeeUser, createInvitation, deliverInvitation, inviteMessage, setInviteSchedule } from '../lib/invites';
import { parseBulkUpdateCsv, splitGroups, EMPLOYEE_NO_HEADER } from '../lib/bulk-update-csv';
import { addManagerChange } from '../lib/job-changes';
import {
  activityParamsSchema, bulkChangeManagerSchema, bulkSendInvitesSchema, bulkTemplateSchema, bulkUpdateSchema, changeEmployeeNoSchema,
  changeRequestFileSchema, changeRequestIdSchema, changeRequestListParamsSchema, checkMykadSchema, confirmEmployeeSchema,
  createDocumentSchema, createEmployeeSchema, createHrNoteSchema, decideChangeRequestSchema, deleteJobChangeSchema,
  deletePriorEmploymentSchema, directoryParamsSchema, documentIdSchema, documentListParamsSchema, employeeIdSchema,
  employeeListParamsSchema, extendProbationSchema, fileIdSchema, inviteEmployeeSchema, myDocumentListParamsSchema, myTeamParamsSchema,
  probationRecommendationSchema, recordSeparationSchema, rehireEmployeeSchema, requestChangeRequestUploadSchema,
  requestEmployeeFileUploadSchema, revealChangeRequestValueSchema, revealEmployeeValueSchema, revealMyValueSchema,
  saveBankDetailsSchema, saveChildCountsSchema, saveChildSchema, saveEmergencyContactsSchema, saveMyEmergencyContactsSchema,
  savePriorEmploymentSchema, saveSpouseSchema, saveStatutorySchema, setChildActiveSchema, setDocumentActiveSchema, setPhotoSchema,
  submitChangeRequestSchema, updateContactSchema, updateDocumentSchema, updateEmploymentSchema, updateHrNoteSchema,
  updateJobChangeSchema, updateMyContactSchema, updateMyPersonalSchema, updateMykadSchema, updateMySpousePhoneSchema,
  updatePersonalSchema, updateSensitiveSchema, updateSeparationSchema, withdrawOfferSchema, withdrawResignationSchema,
  addJobChangeSchema, employeeOptionsSchema, jobChangeContextSchema, separationPreviewSchema,
  BULK_UPDATE_FIELD_LABELS, BULK_UPDATE_HEADERS, CR_CATEGORY_LABELS, CR_STATUS_LABELS, DEFAULT_VISIBLE_DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS, EMPLOYMENT_STATUS_LABELS, GENDER_LABELS, JOB_CHANGE_TYPE_LABELS, MARITAL_STATUS_LABELS,
  PORTAL_ACCOUNT_STATE_LABELS, RACE_LABELS, REVEAL_REASON_LABELS, RELIGION_LABELS,
  ageOn, checkMykad, formatMykad, joinAgeCheck, lengthOfServiceText, maskAccount, maskMykad,
  type ActionResult, type BulkChangeManagerResult, type BulkSendInvitesResult, type BulkUpdateCommitResult, type BulkUpdateField,
  type BulkUpdatePreview, type BulkUpdatePreviewRow, type CheckMykadResult, type CreateEmployeeResult, type CsvFile,
  type DecideChangeRequestResult, type EmploymentStatus, type InviteEmployeeResult, type RevealResult, type SaveBankDetailsResult,
  type SubmitChangeRequestResult, type UploadIntent, type ChangeRequestFormOptions, type EmployeeOption, type JobChangeContext,
  type SeparationPreview,
} from '../contracts/employees';
import {
  activityRows, addDays, changeRequestFormOptions, changeRequestRows, currentEmployeeId, directoryRows, documentRows, employeeOptionRows,
  employeeRows, fieldChangeRows, jobChangeContext, loadCore, myDocumentRows, separationPreview, teamRows, todayMyt,
} from '../queries/employees';

const ADMIN: Role[] = ['ADM', 'SA'];
const SA: Role[] = ['SA'];
const ANY: Role[] = ['EMP', 'MGR', 'ADM', 'SA'];
const TEAM: Role[] = ['MGR', 'ADM', 'SA'];
const NOT_FOUND = { ok: false as const, error: NO_ACCESS };
const OWN_CR = 'Use a change request for your own record.';
const ACTIVE = ['pending_join', 'on_probation', 'confirmed', 'notice_period'];

// ---------------------------------------------------------------------------
// Field encryption references (AAD = table:column:rowId — ADR-0003) and blind-index purposes
// ---------------------------------------------------------------------------
const REF = {
  nric: (employeeId: string): FieldRef => ({ table: 'employee_personal', column: 'nric_enc', rowId: employeeId }),
  spouse: (id: string): FieldRef => ({ table: 'employee_spouses', column: 'nric_enc', rowId: id }),
  child: (id: string): FieldRef => ({ table: 'employee_children', column: 'nric_enc', rowId: id }),
  bank: (id: string): FieldRef => ({ table: 'employee_bank_accounts', column: 'account_no_enc', rowId: id }),
  asnb: (id: string): FieldRef => ({ table: 'employee_bank_accounts', column: 'asnb_account_no_enc', rowId: id }),
};
const BIDX = { nric: 'nric', spouse: 'spouse_nric', child: 'child_nric', bank: 'bank_account' } as const;

async function exported(tx: Tx, entityType: string, count: number, categories: ('identity' | 'contact')[] = []) {
  await writeAccess(tx, { action: 'export', entityType, recordCount: count, categories });
}
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const dmy = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');

async function isOwn(tx: Tx, employeeId: string): Promise<boolean> {
  return (await currentEmployeeId(tx)) === employeeId;
}
async function settings(tx: Tx) {
  return (await sql<{ allowed_email_domains: string[]; invite_lead_days: number; rehire_keep_employee_no: boolean }>`
    select allowed_email_domains::text[] as allowed_email_domains, invite_lead_days, rehire_keep_employee_no
      from app.security_settings where id = 1`.execute(tx)).rows[0];
}
function domainOk(email: string, domains: string[] | undefined): boolean {
  if (!domains || domains.length === 0) return true;
  const d = email.split('@')[1]?.toLowerCase() ?? '';
  return domains.some((x) => x.toLowerCase() === d);
}
async function storedMykad(tx: Tx, employeeId: string): Promise<string | null> {
  const r = (await sql<{ nric_enc: Buffer }>`select nric_enc from app.employee_personal where employee_id = ${employeeId}::uuid`.execute(tx)).rows[0];
  if (!r) return null;
  try { return fieldCrypto.decrypt(r.nric_enc, REF.nric(employeeId)); } catch { return null; }
}
async function duplicateByNric(tx: Tx, digits: string, exclude: string | null) {
  const bidx = fieldCrypto.blindIndex(BIDX.nric, digits);
  return (await sql<{ id: string; employee_no: string; full_name: string; status: EmploymentStatus }>`
    select e.id, e.employee_no, e.full_name, e.status::text as status from app.employee_personal p join app.employees e on e.id = p.employee_id
     where p.nric_bidx = ${bidx} and ${exclude ? sql`e.id <> ${exclude}::uuid` : sql`true`}`.execute(tx)).rows[0] ?? null;
}

// ===========================================================================
// E1 export
// ===========================================================================
export async function exportEmployeesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, employeeListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await employeeRows(tx, p, true);
      await exported(tx, 'employees', rows.length, ['contact']);
      // FR-G-06 / §5.7: list columns only — never NRIC, bank, religion, OKU or family
      return csvFile('employees', ['Employee no.', 'Full name', 'Preferred name', 'Department', 'Position', 'Grade', 'Reporting manager',
        'Work location', 'State', 'Join date', 'Years of service', 'Status', 'Work email', 'Mobile', 'Completeness %', 'Portal account'],
        rows.map((r) => [r.employeeNo, r.fullName, r.preferredName, r.department.label, r.position.label, r.grade.label, r.manager?.name ?? '',
          r.workLocation.label, r.workState, csvDate(r.joinDate), lengthOfServiceText(r.lengthOfService), EMPLOYMENT_STATUS_LABELS[r.status],
          r.workEmail, r.mobilePhone, r.completeness.pct, PORTAL_ACCOUNT_STATE_LABELS[r.portalAccount]]));
    }));
}

// ===========================================================================
// E2 MyKad check + create
// ===========================================================================
export async function checkMykadAction(input: Input): Promise<ActionResult<CheckMykadResult>> {
  return runAction(ADMIN, checkMykadSchema, input, async (d, { ctx }) => {
    const c = checkMykad(d.mykad);
    if (!c.ok) return { valid: false, error: c.error, display: d.mykad, dateOfBirth: null, gender: null, warnings: [], duplicate: null };
    const dup = await withUserTx(ctx, (tx) => duplicateByNric(tx, c.digits, d.excludeEmployeeId ?? null));
    return {
      valid: true, error: null, display: formatMykad(c.digits), dateOfBirth: c.dateOfBirth, gender: c.gender, warnings: c.warnings,
      duplicate: dup ? { employeeId: dup.id, employeeNo: dup.employee_no, name: dup.full_name, status: dup.status, canRehire: dup.status === 'separated' } : null,
    };
  });
}

/** Statutory defaults (§5.3 H, BR-EMP-20): SOCSO no. = MyKad; SOCSO category / EIS by age < 60. */
function statutoryDefaults(dob: string, joinDate: string) {
  const age = ageOn(dob, joinDate);
  return { socsoCategory: age < 60 ? 'category_1' : 'category_2', payEis: age < 60 };
}

export async function createEmployee(input: Input): Promise<ActionResult<CreateEmployeeResult>> {
  return runAction(ADMIN, createEmployeeSchema, input, async (d, { user, ctx }) => {
    const isSa = hasRole(user, 'SA');
    const { identity: i, contact: c, employment: m } = d;
    if (m.isTopOfOrg && !isSa) return fail('Only a Super Admin can tick Top of organisation.', { 'employment.isTopOfOrg': 'Only a Super Admin can tick Top of organisation.' });
    if (m.employeeNo && !isSa) return fail('Only a Super Admin can type an employee no.', { 'employment.employeeNo': 'Only a Super Admin can type an employee no.' });
    const age = joinAgeCheck(i.dateOfBirth, m.joinDate);
    if (age.block) return fail('The employee must be at least 15 years old on the join date.', { 'identity.dateOfBirth': 'Must be at least 15 on the join date (verify).' });
    const warnings: string[] = [...checkMykad(i.mykad).warnings];
    if (age.warn) warnings.push(`The employee is ${age.age} on the join date (under 18).`);
    if (i.photoFileId) warnings.push('The photo can be added once the record exists (CHANGE PHOTO on the profile).');
    const reasons = [i.dobOverrideConfirmed ? 'DOB differs from MyKad (override confirmed)' : '', i.genderOverrideConfirmed ? 'Gender differs from MyKad (override confirmed)' : ''].filter(Boolean);
    const id = randomUUID();
    const res = await withUserTx({ ...ctx, reason: reasons.join('; ') || ctx.reason }, async (tx) => {
      const st = await settings(tx);
      if (!domainOk(c.workEmail, st?.allowed_email_domains)) return fail('The work email must use an allowed company domain.', { 'contact.workEmail': `Allowed domains: ${(st?.allowed_email_domains ?? []).join(', ')}` });
      const dup = await duplicateByNric(tx, i.mykad, null);
      if (dup) {
        const msg = `MyKad already exists for ${dup.employee_no}.`;
        return fail(msg, { 'identity.mykad': msg });
      }
      const today = await todayMyt(tx);
      const employeeNo = m.employeeNo ?? (await sql<{ no: string }>`select app.allocate_employee_no() as no`.execute(tx)).rows[0]!.no;
      await sql`insert into app.employees (id, employee_no, full_name, preferred_name, gender, work_email, mobile_phone, work_phone, join_date,
                  probation_months, department_id, position_id, grade_id, manager_employee_id, work_location_id, working_pattern_id,
                  leave_approver_employee_id, claim_approver_employee_id)
                values (${id}::uuid, ${employeeNo}, ${i.fullName}, ${i.preferredName}, ${i.gender}::app.gender, ${c.workEmail}, ${c.mobilePhone},
                  ${c.workPhone}, ${m.joinDate}::date, ${m.probationMonths}, ${m.departmentId}::uuid, ${m.positionId}::uuid, ${m.gradeId}::uuid,
                  ${m.managerId}::uuid, ${m.workLocationId}::uuid, ${m.workingPatternId}::uuid, ${m.leaveApproverId}::uuid, ${m.claimApproverId}::uuid)`.execute(tx);
      const enc = protectIdentifier(i.mykad, REF.nric(id), BIDX.nric);
      const mail = c.mailingSameAsResidential ? null : c.mailingAddress ?? null;
      await sql`insert into app.employee_personal (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, dob_overridden, race, race_other,
                  passport_no, passport_expiry, highest_qualification, personal_email, res_addr_line1, res_addr_line2, res_addr_line3, res_postcode,
                  res_city, res_state, res_country, mailing_same_as_residential, mail_addr_line1, mail_addr_line2, mail_addr_line3, mail_postcode,
                  mail_city, mail_state, mail_country, continuous_service_date, contractual_notice_value, contractual_notice_unit)
                values (${id}::uuid, ${enc.enc}, ${enc.last4}, ${enc.bidx}, ${i.dateOfBirth}::date, ${i.dobOverrideConfirmed && checkMykad(i.mykad).dateOfBirth !== i.dateOfBirth},
                  ${i.race}::app.race, ${i.race === 'others' ? i.raceOther : null}, ${i.passportNo}, ${i.passportExpiry}::date,
                  ${i.highestQualification}::app.qualification, ${c.personalEmail}, ${c.residentialAddress.line1}, ${c.residentialAddress.line2},
                  ${c.residentialAddress.line3}, ${c.residentialAddress.postcode}, ${c.residentialAddress.city}, ${c.residentialAddress.state}::app.my_state,
                  ${c.residentialAddress.country}, ${c.mailingSameAsResidential}, ${mail?.line1 ?? null}, ${mail?.line2 ?? null}, ${mail?.line3 ?? null},
                  ${mail?.postcode ?? null}, ${mail?.city ?? null}, ${mail?.state ?? null}::app.my_state, ${mail?.country ?? null},
                  ${m.continuousServiceDate ?? m.joinDate}::date, ${m.contractualNoticeValue}, ${m.contractualNoticeUnit}::app.notice_unit)`.execute(tx);
      await sql`insert into app.employee_marital_history (employee_id, marital_status, effective_date)
                values (${id}::uuid, ${i.maritalStatus}::app.marital_status, ${i.maritalEffectiveDate ?? m.joinDate}::date)`.execute(tx);
      await sql`select app.write_employee_sensitive(${id}::uuid, ${i.religion}::app.religion, ${i.isOku}, ${i.isOku ? i.okuCardNo : null})`.execute(tx);
      await sql`insert into app.employee_hr_private (employee_id, is_top_of_org, ph_state_override, cost_centre_id, offer_contract_ref, contract_signed_date)
                values (${id}::uuid, ${m.isTopOfOrg && isSa}, ${m.phStateOverride}::app.my_state, ${m.costCentreId}::uuid, ${m.offerContractRef},
                  ${m.contractSignedDate}::date)`.execute(tx);
      for (const g of [...new Set(m.employeeGroupIds)]) {
        await sql`insert into app.employee_group_members (group_id, employee_id) values (${g}::uuid, ${id}::uuid)`.execute(tx);
      }
      await insertContacts(tx, id, d.emergencyContacts);
      const def = statutoryDefaults(i.dateOfBirth, m.joinDate);
      const s = d.statutory;
      await sql`insert into app.employee_statutory_profiles (employee_id, pay_pcb, income_tax_no, is_tax_resident, lhdn_branch_id, pay_epf, epf_no,
                  epf_rate_type, epf_specific_rate, epf_extra_employee_pct, pay_socso, socso_no, socso_category, socso_contributed_before, pay_eis,
                  pay_zakat, zakat_monthly_amount, zakat_account_no, zakat_body_id, ptptn_monthly_amount, ptptn_start_date, ptptn_end_date)
                values (${id}::uuid, ${s?.payPcb ?? true}, ${s?.incomeTaxNo ?? null}, ${s?.isTaxResident ?? true}, ${s?.lhdnBranchId ?? null}::uuid,
                  ${s?.payEpf ?? true}, ${s?.epfNo ?? null}, ${s?.epfRateType ?? 'statutory'}::app.epf_rate_type, ${s?.epfSpecificRate ?? null}::numeric,
                  ${s?.epfExtraEmployeePct ?? null}::numeric, ${s?.paySocso ?? true}, ${s?.socsoNo ?? i.mykad},
                  ${s?.socsoCategory ?? def.socsoCategory}::app.socso_category, ${s?.socsoContributedBefore ?? null}, ${s?.payEis ?? def.payEis},
                  ${s?.payZakat ?? false}, ${s?.zakatMonthlyAmount ?? null}::numeric, ${s?.zakatAccountNo ?? null}, ${s?.zakatBodyId ?? null}::uuid,
                  ${s?.ptptnMonthlyAmount ?? null}::numeric, ${s?.ptptnStartDate ?? null}::date, ${s?.ptptnEndDate ?? null}::date)`.execute(tx);
      await insertEmployerFlags(tx, id, d.employerFlags ?? {}, true);
      if (d.bank) {
        if (d.bank.paymentMethod === 'bank_transfer') warnings.push('Bank account not saved: add it with EDIT BANK DETAILS on the profile (the proof upload needs the record first).');
        else await sql`insert into app.employee_bank_accounts (employee_id, payment_method, effective_from, verified_by)
                       values (${id}::uuid, ${d.bank.paymentMethod}::app.payment_method, ${d.bank.effectiveFrom ?? today}::date, app.current_app_user_id())`.execute(tx);
      }
      const status = (await sql<{ status: EmploymentStatus }>`select status::text as status from app.employees where id = ${id}::uuid`.execute(tx)).rows[0]!.status;
      // FR-EMP-02 invite: now / scheduled (default join date − lead days) / later
      let scheduledFor: string | null = null;
      let userId: string | null = null;
      let inv = null as Awaited<ReturnType<typeof createInvitation>> | null;
      let email = ''; let displayName = '';
      if (d.invite.mode !== 'later') {
        const date = d.invite.mode === 'scheduled' ? (d.invite.scheduledSendDate ?? addDays(m.joinDate, -(st?.invite_lead_days ?? 3))) : today;
        const sendNow = date <= today;
        const u = await createEmployeeUser(tx, id, sendNow ? null : date);
        userId = u.userId; email = u.email; displayName = u.displayName;
        if (sendNow) inv = await createInvitation(tx, u.userId); else scheduledFor = date;
      }
      return { employeeNo, status, userId, inv, scheduledFor, email, displayName, co: await companyName(tx) };
    });
    if ('ok' in res) return res;
    let emailSent = false;
    let message = d.invite.mode === 'later' ? 'No invitation scheduled — invite later from the profile.' : '';
    if (res.inv) { emailSent = await deliverInvitation(res.inv, { email: res.email, displayName: res.displayName }, res.co); message = inviteMessage(emailSent); }
    else if (res.scheduledFor) message = `Invitation scheduled for ${dmy(res.scheduledFor)}.`;
    return { employeeId: id, employeeNo: res.employeeNo, status: res.status, warnings,
      invite: { mode: d.invite.mode, userId: res.userId, scheduledFor: res.scheduledFor, emailSent, message } };
  }, { mykad: 'identity.mykad', workEmail: 'contact.workEmail', employeeNo: 'employment.employeeNo', managerId: 'employment.managerId',
       isTopOfOrg: 'employment.isTopOfOrg', leaveApproverId: 'employment.leaveApproverId', joinDate: 'employment.joinDate',
       personalEmail: 'contact.personalEmail', contacts: 'emergencyContacts', continuousServiceDate: 'employment.continuousServiceDate' });
}

type ContactIn = { priority: number; name: string; relationship: string; mobilePhone: string; altPhone: string | null; email: string | null; isNextOfKin: boolean };
async function insertContacts(tx: Tx, employeeId: string, contacts: ContactIn[]) {
  for (const k of contacts) {
    await sql`insert into app.employee_emergency_contacts (employee_id, priority, name, relationship, mobile_phone, alt_phone, email, is_next_of_kin)
              values (${employeeId}::uuid, ${k.priority}, ${k.name}, ${k.relationship}::app.contact_relationship, ${k.mobilePhone}, ${k.altPhone},
                ${k.email}, ${k.isNextOfKin})`.execute(tx);
  }
}
type FlagsIn = { pcbBorneByEmployer?: boolean; returningExpertProgramme?: boolean; knowledgeWorkerSpecifiedRegion?: boolean; epfBorneByEmployer?: boolean;
  epfExtraEmployerPct?: string | null; socsoBorneByEmployer?: boolean; paySkbbk?: boolean; skbbkBorneByEmployer?: boolean; eisBorneByEmployer?: boolean; payHrdf?: boolean };
async function insertEmployerFlags(tx: Tx, employeeId: string, f: FlagsIn, insert: boolean) {
  const hrdf = f.payHrdf ?? ((await sql<{ h: boolean }>`select hrdf_registered as h from app.company_statutory limit 1`.execute(tx)).rows[0]?.h ?? false);
  const vals = sql`${f.pcbBorneByEmployer ?? false}, ${f.returningExpertProgramme ?? false}, ${f.knowledgeWorkerSpecifiedRegion ?? false},
    ${f.epfBorneByEmployer ?? false}, ${f.epfExtraEmployerPct ?? null}::numeric, ${f.socsoBorneByEmployer ?? false}, ${f.paySkbbk ?? false},
    ${f.skbbkBorneByEmployer ?? false}, ${f.eisBorneByEmployer ?? false}, ${hrdf}`;
  if (insert) {
    await sql`insert into app.employee_statutory_employer_flags (employee_id, pcb_borne_by_employer, returning_expert_programme,
                knowledge_worker_specified_region, epf_borne_by_employer, epf_extra_employer_pct, socso_borne_by_employer, pay_skbbk,
                skbbk_borne_by_employer, eis_borne_by_employer, pay_hrdf) values (${employeeId}::uuid, ${vals})`.execute(tx);
  } else {
    await sql`update app.employee_statutory_employer_flags set (pcb_borne_by_employer, returning_expert_programme, knowledge_worker_specified_region,
                epf_borne_by_employer, epf_extra_employer_pct, socso_borne_by_employer, pay_skbbk, skbbk_borne_by_employer, eis_borne_by_employer, pay_hrdf)
                = (${vals}) where employee_id = ${employeeId}::uuid`.execute(tx);
  }
}

// ===========================================================================
// E4 Section edits
// ===========================================================================
export async function updatePersonal(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, updatePersonalSchema, input, async (d, { ctx }) => {
    const reasons: string[] = [];
    return withUserTx(ctx, async (tx) => {
      const e = await loadCore(tx, { id: d.employeeId });
      if (!e) return NOT_FOUND;
      const own = await isOwn(tx, e.id);
      const p = (await sql<{ date_of_birth: string; race: string | null; race_other: string | null }>`
        select date_of_birth, race::text as race, race_other from app.employee_personal where employee_id = ${e.id}::uuid`.execute(tx)).rows[0];
      const today = await todayMyt(tx);
      const marital = (await sql<{ marital_status: string }>`select marital_status::text as marital_status from app.employee_marital_history
          where employee_id = ${e.id}::uuid and effective_date <= ${today}::date order by effective_date desc limit 1`.execute(tx)).rows[0]?.marital_status ?? 'single';
      if (own) {
        const changed: Record<string, boolean> = {
          fullName: d.fullName !== e.full_name, dateOfBirth: d.dateOfBirth !== p?.date_of_birth, gender: d.gender !== e.gender,
          race: (d.race ?? null) !== (p?.race ?? null) || (d.raceOther ?? null) !== (p?.race_other ?? null), maritalStatus: d.maritalStatus !== marital,
        };
        const keys = Object.keys(changed).filter((k) => changed[k]);
        if (keys.length) return fail(OWN_CR, Object.fromEntries(keys.map((k) => [k, OWN_CR])));
      }
      const mykad = await storedMykad(tx, e.id);
      const derived = mykad ? checkMykad(mykad) : null;
      const dobOverride = !!derived?.dateOfBirth && derived.dateOfBirth !== d.dateOfBirth;
      if (dobOverride && d.dateOfBirth !== p?.date_of_birth) {
        if (!d.dobOverrideConfirmed) return fail('DOB differs from MyKad — confirm the override.', { dobOverrideConfirmed: 'DOB differs from MyKad — confirm the override.' });
        reasons.push('DOB differs from MyKad (override confirmed)');
      }
      if (derived?.gender && derived.gender !== d.gender && d.gender !== e.gender) {
        if (!d.genderOverrideConfirmed) return fail('Gender differs from MyKad — confirm the override.', { genderOverrideConfirmed: 'Gender differs from MyKad — confirm the override.' });
        reasons.push('Gender differs from MyKad (override confirmed)');
      }
      if (d.maritalStatus !== marital) {
        if (!d.maritalEffectiveDate) return fail('Enter the marital status effective date.', { maritalEffectiveDate: 'Enter the marital status effective date.' });
        if (d.maritalEffectiveDate > addDays(today, 30)) return fail('The effective date can be at most 30 days ahead.', { maritalEffectiveDate: 'At most 30 days ahead.' });
      }
      if (reasons.length) await sql`select set_config('app.reason', ${reasons.join('; ')}, true)`.execute(tx);
      await sql`update app.employees set full_name = ${d.fullName}, preferred_name = ${d.preferredName}, gender = ${d.gender}::app.gender
                where id = ${e.id}::uuid`.execute(tx);
      await sql`update app.employee_personal set date_of_birth = ${d.dateOfBirth}::date, dob_overridden = ${dobOverride},
                  race = ${d.race}::app.race, race_other = ${d.race === 'others' ? d.raceOther : null}, passport_no = ${d.passportNo},
                  passport_expiry = ${d.passportExpiry}::date, highest_qualification = ${d.highestQualification}::app.qualification
                where employee_id = ${e.id}::uuid`.execute(tx);
      if (d.maritalStatus !== marital) {
        await sql`insert into app.employee_marital_history (employee_id, marital_status, effective_date)
                  values (${e.id}::uuid, ${d.maritalStatus}::app.marital_status, ${d.maritalEffectiveDate}::date)`.execute(tx);
      }
      return {};
    });
  });
}

export async function updateMykad(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, updateMykadSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (!(await loadCore(tx, { id: d.employeeId }))) return NOT_FOUND;
      if (await isOwn(tx, d.employeeId)) return fail(OWN_CR, { mykad: OWN_CR });
      const dup = await duplicateByNric(tx, d.mykad, d.employeeId);
      if (dup) return fail(`MyKad already exists for ${dup.employee_no}.`, { mykad: `MyKad already exists for ${dup.employee_no}.` });
      const enc = protectIdentifier(d.mykad, REF.nric(d.employeeId), BIDX.nric);
      await sql`update app.employee_personal set nric_enc = ${enc.enc}, nric_last4 = ${enc.last4}, nric_bidx = ${enc.bidx}
                where employee_id = ${d.employeeId}::uuid`.execute(tx);
      return {};
    }), { mykad: 'mykad' });
}

export async function updateSensitive(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, updateSensitiveSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (await isOwn(tx, d.employeeId)) return fail(OWN_CR, { religion: OWN_CR });
      await sql`select app.write_employee_sensitive(${d.employeeId}::uuid, ${d.religion}::app.religion, ${d.isOku}, ${d.isOku ? d.okuCardNo : null})`.execute(tx);
      return {};
    }));
}

export async function changeEmployeeNo(input: Input): Promise<ActionResult> {
  return runAction(SA, changeEmployeeNoSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
      const r = await sql`update app.employees set employee_no = ${d.employeeNo.toUpperCase()} where id = ${d.employeeId}::uuid`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }));
}

export async function updateContact(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, updateContactSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const e = await loadCore(tx, { id: d.employeeId });
      if (!e) return NOT_FOUND;
      if (d.workEmail !== e.work_email.toLowerCase()) {
        if (await isOwn(tx, e.id)) return fail(OWN_CR, { workEmail: OWN_CR });
        const st = await settings(tx);
        if (!domainOk(d.workEmail, st?.allowed_email_domains)) return fail('The work email must use an allowed company domain.', { workEmail: `Allowed domains: ${(st?.allowed_email_domains ?? []).join(', ')}` });
        const acc = (await sql<{ accepted: boolean }>`select accepted from app.employee_portal_accounts(array[${e.id}]::uuid[])`.execute(tx)).rows[0];
        if (acc?.accepted) return fail("The work email is this user's sign-in and can't change after the invitation was accepted.", { workEmail: "Can't change after the invitation was accepted (open question Q-W3-03)." });
      }
      await sql`update app.employees set work_email = ${d.workEmail}, mobile_phone = ${d.mobilePhone}, work_phone = ${d.workPhone}
                where id = ${e.id}::uuid`.execute(tx);
      await updateAddress(tx, e.id, d);
      return {};
    }));
}
type AddrIn = { personalEmail: string; residentialAddress: { line1: string; line2: string | null; line3: string | null; postcode: string; city: string; state: string; country: string };
  mailingSameAsResidential: boolean; mailingAddress?: AddrIn['residentialAddress'] | null };
async function updateAddress(tx: Tx, employeeId: string, d: AddrIn) {
  const r = d.residentialAddress; const m = d.mailingSameAsResidential ? null : d.mailingAddress ?? null;
  await sql`update app.employee_personal set personal_email = ${d.personalEmail}, res_addr_line1 = ${r.line1}, res_addr_line2 = ${r.line2},
              res_addr_line3 = ${r.line3}, res_postcode = ${r.postcode}, res_city = ${r.city}, res_state = ${r.state}::app.my_state, res_country = ${r.country},
              mailing_same_as_residential = ${d.mailingSameAsResidential}, mail_addr_line1 = ${m?.line1 ?? null}, mail_addr_line2 = ${m?.line2 ?? null},
              mail_addr_line3 = ${m?.line3 ?? null}, mail_postcode = ${m?.postcode ?? null}, mail_city = ${m?.city ?? null},
              mail_state = ${m?.state ?? null}::app.my_state, mail_country = ${m?.country ?? null}
            where employee_id = ${employeeId}::uuid`.execute(tx);
}

export async function saveEmergencyContacts(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, saveEmergencyContactsSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (!(await loadCore(tx, { id: d.employeeId }))) return NOT_FOUND;
      await sql`delete from app.employee_emergency_contacts where employee_id = ${d.employeeId}::uuid`.execute(tx);
      await insertContacts(tx, d.employeeId, d.contacts);
      return {};
    }));
}

export async function setEmployeePhoto(input: Input): Promise<ActionResult> {
  return runAction(ANY, setPhotoSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update app.employees set photo_file_id = ${d.fileId}::uuid where id = ${d.employeeId}::uuid`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }), { fileId: 'fileId' });
}

export async function saveSpouse(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, saveSpouseSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (await isOwn(tx, d.employeeId)) return fail(OWN_CR);
      const id = d.id ?? randomUUID();
      const enc = d.mykad ? protectIdentifier(d.mykad, REF.spouse(id), BIDX.spouse) : null;
      if (!d.id) {
        await sql`insert into app.employee_spouses (id, employee_id, full_name, nric_enc, nric_last4, nric_bidx, marriage_date, working_status, is_oku,
                    income_tax_no, relief_claimed_by_employee, record_status, phone)
                  values (${id}::uuid, ${d.employeeId}::uuid, ${d.fullName}, ${enc!.enc}, ${enc!.last4}, ${enc!.bidx}, ${d.marriageDate}::date, ${d.workingStatus},
                    ${d.isOku}, ${d.incomeTaxNo}, ${d.reliefClaimedByEmployee}, ${d.recordStatus}::app.spouse_record_status, ${d.phone})`.execute(tx);
      } else {
        const r = await sql`update app.employee_spouses set full_name = ${d.fullName}, marriage_date = ${d.marriageDate}::date, working_status = ${d.workingStatus},
                    is_oku = ${d.isOku}, income_tax_no = ${d.incomeTaxNo}, relief_claimed_by_employee = ${d.reliefClaimedByEmployee},
                    record_status = ${d.recordStatus}::app.spouse_record_status, phone = ${d.phone}
                    ${enc ? sql`, nric_enc = ${enc.enc}, nric_last4 = ${enc.last4}, nric_bidx = ${enc.bidx}` : sql``}
                  where id = ${id}::uuid and employee_id = ${d.employeeId}::uuid`.execute(tx);
        if (!Number(r.numAffectedRows ?? 0)) return NOT_FOUND;
      }
      return { id };
    }));
}

export async function saveChild(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, saveChildSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (await isOwn(tx, d.employeeId)) return fail(OWN_CR);
      const today = await todayMyt(tx);
      const age = ageOn(d.dateOfBirth, today);
      if (d.pcbCategory === 'under_18' && age >= 18) return fail('"Under 18" does not match the child\'s age.', { pcbCategory: 'Not consistent with the age (BR-EMP-17).' });
      if ((d.pcbCategory === 'over_18_pre_university' || d.pcbCategory === 'over_18_diploma_plus') && age < 18)
        return fail('An 18+ category does not match the child\'s age.', { pcbCategory: 'Not consistent with the age (BR-EMP-17).' });
      const id = d.id ?? randomUUID();
      const enc = d.mykad ? protectIdentifier(d.mykad, REF.child(id), BIDX.child) : null;
      if (!d.id) {
        await sql`insert into app.employee_children (id, employee_id, full_name, nric_enc, nric_last4, nric_bidx, date_of_birth, gender, relationship,
                    pcb_category, relief_share, institution_level, is_oku)
                  values (${id}::uuid, ${d.employeeId}::uuid, ${d.fullName}, ${enc?.enc ?? null}, ${enc?.last4 ?? null}, ${enc?.bidx ?? null},
                    ${d.dateOfBirth}::date, ${d.gender}::app.gender, ${d.relationship}::app.child_relationship, ${d.pcbCategory}::app.pcb_child_category,
                    ${d.reliefShare}::app.relief_share, ${d.institutionLevel}, ${d.isOku})`.execute(tx);
      } else {
        const r = await sql`update app.employee_children set full_name = ${d.fullName}, date_of_birth = ${d.dateOfBirth}::date, gender = ${d.gender}::app.gender,
                    relationship = ${d.relationship}::app.child_relationship, pcb_category = ${d.pcbCategory}::app.pcb_child_category,
                    relief_share = ${d.reliefShare}::app.relief_share, institution_level = ${d.institutionLevel}, is_oku = ${d.isOku}
                    ${enc ? sql`, nric_enc = ${enc.enc}, nric_last4 = ${enc.last4}, nric_bidx = ${enc.bidx}` : sql``}
                  where id = ${id}::uuid and employee_id = ${d.employeeId}::uuid`.execute(tx);
        if (!Number(r.numAffectedRows ?? 0)) return NOT_FOUND;
      }
      return { id };
    }));
}

export async function setChildActive(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, setChildActiveSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update app.employee_children set is_active = ${d.isActive} where id = ${d.id}::uuid`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }));
}

export async function saveChildCounts(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, saveChildCountsSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const c = d.counts;
      const r = await sql`update app.employee_statutory_profiles set child_count_lt18 = ${c?.lt18 ?? null}, child_count_tertiary = ${c?.tertiary ?? null},
                  child_count_disabled_lt18 = ${c?.disabledLt18 ?? null}, child_count_disabled_tertiary = ${c?.disabledTertiary ?? null}
                where employee_id = ${d.employeeId}::uuid`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }));
}

export async function updateEmployment(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, updateEmploymentSchema, input, async (d, { user, ctx }) =>
    withUserTx(ctx, async (tx) => {
      const e = await loadCore(tx, { id: d.employeeId });
      if (!e) return NOT_FOUND;
      await sql`update app.employees set join_date = ${d.joinDate}::date, probation_months = ${d.probationMonths},
                  leave_approver_employee_id = ${d.leaveApproverId}::uuid, claim_approver_employee_id = ${d.claimApproverId}::uuid
                where id = ${e.id}::uuid`.execute(tx);
      await sql`update app.employee_personal set continuous_service_date = ${d.continuousServiceDate}::date,
                  contractual_notice_value = ${d.contractualNoticeValue}, contractual_notice_unit = ${d.contractualNoticeUnit}::app.notice_unit
                where employee_id = ${e.id}::uuid`.execute(tx);
      const top = hasRole(user, 'SA') && d.isTopOfOrg !== undefined ? sql`, is_top_of_org = ${d.isTopOfOrg}` : sql``;
      await sql`update app.employee_hr_private set ph_state_override = ${d.phStateOverride}::app.my_state, cost_centre_id = ${d.costCentreId}::uuid,
                  offer_contract_ref = ${d.offerContractRef}, contract_signed_date = ${d.contractSignedDate}::date ${top}
                where employee_id = ${e.id}::uuid`.execute(tx);
      const ids = [...new Set(d.employeeGroupIds)];
      await sql`delete from app.employee_group_members where employee_id = ${e.id}::uuid and not (group_id = any(${ids}::uuid[]))`.execute(tx);
      for (const g of ids) await sql`insert into app.employee_group_members (group_id, employee_id) values (${g}::uuid, ${e.id}::uuid) on conflict do nothing`.execute(tx);
      return {};
    }));
}

// ===========================================================================
// E5 Job changes
// ===========================================================================
export async function addJobChange(input: Input): Promise<ActionResult<{ id: string; scheduled: boolean }>> {
  return runAction(ADMIN, addJobChangeSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string; scheduled: boolean }>`
        insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id, manager_employee_id,
          work_location_id, working_pattern_id, remarks, reference_document_id)
        values (${d.employeeId}::uuid, ${d.effectiveDate}::date, ${d.changeType}::app.job_change_type, ${d.departmentId}::uuid, ${d.positionId}::uuid,
          ${d.gradeId}::uuid, ${d.managerId}::uuid, ${d.workLocationId}::uuid, ${d.workingPatternId}::uuid, ${d.remarks}, ${d.referenceDocumentId}::uuid)
        returning id, effective_date > app.today_myt() as scheduled`.execute(tx);
      return r.rows[0]!;
    }));
}

export async function updateJobChange(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updateJobChangeSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.changeType === 'data_correction' ? d.remarks : ctx.reason }, async (tx) => {
      const cur = (await sql<{ version: number }>`select version from app.employee_job_history where id = ${d.id}::uuid and not is_deleted for update`.execute(tx)).rows[0];
      if (!cur) return NOT_FOUND;
      if (cur.version !== d.version) return fail('This job change was updated by someone else — refresh and try again.');
      await sql`update app.employee_job_history set effective_date = ${d.effectiveDate}::date, change_type = ${d.changeType}::app.job_change_type,
                  department_id = ${d.departmentId}::uuid, position_id = ${d.positionId}::uuid, grade_id = ${d.gradeId}::uuid,
                  manager_employee_id = ${d.managerId}::uuid, work_location_id = ${d.workLocationId}::uuid, working_pattern_id = ${d.workingPatternId}::uuid,
                  remarks = ${d.remarks}, reference_document_id = ${d.referenceDocumentId}::uuid
                where id = ${d.id}::uuid`.execute(tx);
      return { id: d.id };
    }));
}

export async function deleteJobChange(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, deleteJobChangeSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
      const r = await sql`update app.employee_job_history set is_deleted = true, delete_reason = ${d.reason} where id = ${d.id}::uuid and not is_deleted`.execute(tx);
      if (!Number(r.numAffectedRows ?? 0)) return NOT_FOUND;
      const emp = (await sql<{ employee_id: string }>`select employee_id from app.employee_job_history where id = ${d.id}::uuid`.execute(tx)).rows[0];
      if (emp) await sql`select 1 from app.employees where id = ${emp.employee_id}::uuid`.execute(tx);
      return {};
    }));
}

export async function exportJobHistoryCsv(input: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, employeeIdSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ effective_date: string; change_type: keyof typeof JOB_CHANGE_TYPE_LABELS; dept: string; pos: string; grade: string; mgr: string | null; loc: string; remarks: string | null; created_at: Date; employee_no: string }>`
        select h.effective_date, h.change_type::text as change_type, d.name as dept, p.title as pos, g.name as grade, m.full_name as mgr, l.name as loc,
               h.remarks, h.created_at, e.employee_no
          from app.employee_job_history h join app.employees e on e.id = h.employee_id
          join app.departments d on d.id = h.department_id join app.positions p on p.id = h.position_id join app.grades g on g.id = h.grade_id
          join app.work_locations l on l.id = h.work_location_id left join app.employees m on m.id = h.manager_employee_id
         where h.employee_id = ${d.employeeId}::uuid and not h.is_deleted order by h.effective_date desc`.execute(tx);
      await writeAccess(tx, { action: 'export', entityType: 'employee_job_history', employeeIds: [d.employeeId], recordCount: r.rows.length });
      return csvFile(`job-history-${r.rows[0]?.employee_no ?? 'employee'}`, ['Effective date', 'Change type', 'Department', 'Position', 'Grade', 'Manager', 'Location', 'Remarks', 'Entered at'],
        r.rows.map((x) => [csvDate(x.effective_date), JOB_CHANGE_TYPE_LABELS[x.change_type], x.dept, x.pos, x.grade, x.mgr, x.loc, x.remarks, csvDateTime(x.created_at)]));
    }));
}

// ===========================================================================
// E6 Probation, E7/E8 separation, E9 rehire
// ===========================================================================
export async function confirmEmployee(input: Input): Promise<ActionResult<{ status: EmploymentStatus }>> {
  return runAction(ADMIN, confirmEmployeeSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ s: EmploymentStatus }>`select app.confirm_employee(${d.employeeId}::uuid, ${d.confirmationDate}::date, ${d.remarks})::text as s`.execute(tx);
      return { status: r.rows[0]!.s };
    }));
}

export async function extendProbation(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, extendProbationSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
      await sql`select app.extend_probation(${d.employeeId}::uuid, ${d.newEndDate}::date, ${d.reason})`.execute(tx);
      return {};
    }));
}

export async function recordSeparation(input: Input): Promise<ActionResult<{ separationId: string; status: EmploymentStatus }>> {
  return runAction(ADMIN, recordSeparationSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (await isOwn(tx, d.employeeId)) return fail('You cannot record your own separation.');
      const pv = await separationPreview(tx, d.employeeId, d.noticeDate, d.lastWorkingDay);
      if (!pv) return NOT_FOUND;
      const sep = (await sql<{ id: string }>`insert into app.employee_separations (employee_id, notice_date, separation_type, last_working_day)
          values (${d.employeeId}::uuid, ${d.noticeDate}::date, ${d.separationType}::app.separation_type, ${d.lastWorkingDay}::date) returning id`.execute(tx)).rows[0]!;
      await sql`insert into app.employee_separation_details (separation_id, employee_id, reason_category, reason_text, notice_required_days,
                  notice_shortfall_days, notice_outcome, portal_access_end_date, eligible_for_rehire, exit_remarks)
                values (${sep.id}::uuid, ${d.employeeId}::uuid, ${d.reasonCategory}::app.separation_reason, ${d.reasonText}, ${pv.noticeRequiredDays},
                  ${pv.shortfallDays}, ${d.noticeOutcome}::app.notice_outcome, ${d.portalAccessEndDate ?? d.lastWorkingDay}::date, ${d.eligibleForRehire},
                  ${d.exitRemarks})`.execute(tx);
      const s = (await sql<{ status: EmploymentStatus }>`select status::text as status from app.employees where id = ${d.employeeId}::uuid`.execute(tx)).rows[0]!;
      return { separationId: sep.id, status: s.status };
    }));
}

export async function updateSeparation(input: Input): Promise<ActionResult<{ status: EmploymentStatus }>> {
  return runAction(ADMIN, updateSeparationSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const cur = (await sql<{ employee_id: string; version: number }>`select employee_id, version from app.employee_separations
          where id = ${d.separationId}::uuid for update`.execute(tx)).rows[0];
      if (!cur) return NOT_FOUND;
      if (cur.version !== d.version) return fail('This separation was updated by someone else — refresh and try again.');
      const pv = await separationPreview(tx, cur.employee_id, d.noticeDate, d.lastWorkingDay);
      await sql`update app.employee_separations set notice_date = ${d.noticeDate}::date, separation_type = ${d.separationType}::app.separation_type,
                  last_working_day = ${d.lastWorkingDay}::date where id = ${d.separationId}::uuid`.execute(tx);
      await sql`update app.employee_separation_details set reason_category = ${d.reasonCategory}::app.separation_reason, reason_text = ${d.reasonText},
                  notice_required_days = ${pv?.noticeRequiredDays ?? 0}, notice_shortfall_days = ${pv?.shortfallDays ?? 0},
                  notice_outcome = ${d.noticeOutcome}::app.notice_outcome, portal_access_end_date = ${d.portalAccessEndDate ?? d.lastWorkingDay}::date,
                  eligible_for_rehire = ${d.eligibleForRehire}, exit_remarks = ${d.exitRemarks}
                where separation_id = ${d.separationId}::uuid`.execute(tx);
      const s = (await sql<{ status: EmploymentStatus }>`select status::text as status from app.employees where id = ${cur.employee_id}::uuid`.execute(tx)).rows[0]!;
      return { status: s.status };
    }));
}

export async function withdrawResignation(input: Input): Promise<ActionResult<{ status: EmploymentStatus }>> {
  return runAction(ADMIN, withdrawResignationSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.remarks }, async (tx) => {
      const r = await sql<{ s: EmploymentStatus }>`select app.withdraw_resignation(${d.employeeId}::uuid, ${d.remarks})::text as s`.execute(tx);
      return { status: r.rows[0]!.s };
    }));
}

export async function withdrawOffer(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, withdrawOfferSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.remarks }, async (tx) => {
      await sql`select app.withdraw_offer(${d.employeeId}::uuid)`.execute(tx);
      return {};
    }));
}

export async function rehireEmployee(input: Input): Promise<ActionResult<{ employeeNo: string; status: EmploymentStatus; invite: CreateEmployeeResult['invite'] }>> {
  return runAction(ADMIN, rehireEmployeeSchema, input, async (d, { user, ctx }) => {
    if (d.newEmployeeNo && !hasRole(user, 'SA')) return fail('Only a Super Admin can type an employee no.', { newEmployeeNo: 'Only a Super Admin can type an employee no.' });
    const res = await withUserTx(ctx, async (tx) => {
      const original = (await sql<{ d: string }>`select min(effective_date)::text as d from app.employee_job_history
          where employee_id = ${d.employeeId}::uuid and change_type = 'new_hire'`.execute(tx)).rows[0]?.d ?? d.joinDate;
      const csd = d.continuousServiceChoice === 'original_join_date' ? original : d.continuousServiceChoice === 'other' ? d.continuousServiceDate! : d.joinDate;
      const newNo = d.keepEmployeeNo ? null : d.newEmployeeNo ?? '';
      const no = (await sql<{ no: string }>`select app.rehire_employee(${d.employeeId}::uuid, ${newNo}, ${d.joinDate}::date, ${csd}::date, ${d.probationMonths},
          ${d.departmentId}::uuid, ${d.positionId}::uuid, ${d.gradeId}::uuid, ${d.managerId}::uuid, ${d.workLocationId}::uuid, ${d.workingPatternId}::uuid) as no`.execute(tx)).rows[0]!.no;
      const status = (await sql<{ s: EmploymentStatus }>`select status::text as s from app.employees where id = ${d.employeeId}::uuid`.execute(tx)).rows[0]!.s;
      const today = await todayMyt(tx);
      const acc = (await sql<{ user_id: string; accepted: boolean }>`select user_id, accepted from app.employee_portal_accounts(array[${d.employeeId}]::uuid[])`.execute(tx)).rows[0];
      let inv: Awaited<ReturnType<typeof createInvitation>> | null = null; let scheduledFor: string | null = null; let userId = acc?.user_id ?? null;
      let email = ''; let displayName = '';
      if (d.invite.mode !== 'later' && !acc?.accepted) {
        const st = await settings(tx);
        const date = d.invite.mode === 'scheduled' ? (d.invite.scheduledSendDate ?? addDays(d.joinDate, -(st?.invite_lead_days ?? 3))) : today;
        if (!acc) { const u = await createEmployeeUser(tx, d.employeeId, null); userId = u.userId; email = u.email; displayName = u.displayName; }
        else { const u = (await sql<{ login_email: string; display_name: string }>`select login_email::text as login_email, display_name from app.app_users where id = ${acc.user_id}::uuid`.execute(tx)).rows[0]; email = u?.login_email ?? ''; displayName = u?.display_name ?? ''; }
        if (date <= today) inv = await createInvitation(tx, userId!); else { await setInviteSchedule(tx, userId!, date); scheduledFor = date; }
      }
      return { no, status, inv, scheduledFor, userId, email, displayName, co: await companyName(tx) };
    });
    let emailSent = false; let message = res.scheduledFor ? `Invitation scheduled for ${dmy(res.scheduledFor)}.` : 'Rehired.';
    if (res.inv) { emailSent = await deliverInvitation(res.inv, { email: res.email, displayName: res.displayName }, res.co); message = inviteMessage(emailSent); }
    return { employeeNo: res.no, status: res.status, invite: { mode: d.invite.mode, userId: res.userId, scheduledFor: res.scheduledFor, emailSent, message } };
  });
}

// ===========================================================================
// Statutory & bank
// ===========================================================================
export async function saveStatutory(input: Input): Promise<ActionResult<{ warnings: string[] }>> {
  return runAction(ADMIN, saveStatutorySchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (await isOwn(tx, d.employeeId)) return fail(OWN_CR);
      const s = d.profile;
      const p = (await sql<{ date_of_birth: string; join_date: string }>`select p.date_of_birth, e.join_date from app.employee_personal p join app.employees e on e.id = p.employee_id
          where p.employee_id = ${d.employeeId}::uuid`.execute(tx)).rows[0];
      if (!p) return NOT_FOUND;
      const def = statutoryDefaults(p.date_of_birth, p.join_date);
      const socsoNo = s.socsoNo ?? (await storedMykad(tx, d.employeeId));
      await sql`update app.employee_statutory_profiles set pay_pcb = ${s.payPcb}, income_tax_no = ${s.incomeTaxNo}, is_tax_resident = ${s.isTaxResident},
                  lhdn_branch_id = ${s.lhdnBranchId}::uuid, pay_epf = ${s.payEpf}, epf_no = ${s.epfNo}, epf_rate_type = ${s.epfRateType}::app.epf_rate_type,
                  epf_specific_rate = ${s.epfRateType === 'specific' ? s.epfSpecificRate : null}::numeric, epf_extra_employee_pct = ${s.epfExtraEmployeePct}::numeric,
                  pay_socso = ${s.paySocso}, socso_no = ${socsoNo}, socso_category = ${s.socsoCategory ?? def.socsoCategory}::app.socso_category,
                  socso_contributed_before = ${s.socsoContributedBefore}, pay_eis = ${s.payEis ?? def.payEis}, pay_zakat = ${s.payZakat},
                  zakat_monthly_amount = ${s.payZakat ? s.zakatMonthlyAmount : null}::numeric, zakat_account_no = ${s.payZakat ? s.zakatAccountNo : null},
                  zakat_body_id = ${s.zakatBodyId}::uuid, ptptn_monthly_amount = ${s.ptptnMonthlyAmount}::numeric, ptptn_start_date = ${s.ptptnStartDate}::date,
                  ptptn_end_date = ${s.ptptnEndDate}::date
                where employee_id = ${d.employeeId}::uuid`.execute(tx);
      await insertEmployerFlags(tx, d.employeeId, d.employerFlags, false);
      // Zakat with religion ≠ Islam is a warning only; HR's view of religion is logged, so it is not read here.
      return { warnings: s.payZakat ? ['Zakat via payroll is set — check the religion on the Personal tab (warning only).'] : [] };
    }));
}

export async function saveBankDetails(input: Input): Promise<ActionResult<SaveBankDetailsResult>> {
  return runAction(ADMIN, saveBankDetailsSchema, input, async (d, { ctx }) => {
    const b = d.bank;
    return withUserTx({ ...ctx, reason: b.sharedAccountRemarks ?? ctx.reason }, async (tx) => {
      const e = await loadCore(tx, { id: d.employeeId });
      if (!e) return NOT_FOUND;
      if (await isOwn(tx, e.id)) return fail(OWN_CR);
      const warnings: string[] = [];
      const id = randomUUID();
      const today = await todayMyt(tx);
      let acc: ReturnType<typeof protectIdentifier> | null = null;
      if (b.paymentMethod === 'bank_transfer') {
        if (norm(b.accountHolderName) !== norm(e.full_name)) {
          if (!b.holderNameMismatchAck) return fail("Holder name differs from the employee's name — joint or third-party accounts are discouraged.", { 'bank.holderNameMismatchAck': 'Tick "Continue anyway" to save.' });
          warnings.push("Holder name differs from the employee's name.");
        }
        acc = protectIdentifier(b.accountNo!, REF.bank(id), BIDX.bank);
        const shared = (await sql<{ no: string }>`select distinct e.employee_no as no from app.employee_bank_accounts x join app.employees e on e.id = x.employee_id
            where x.account_no_bidx = ${acc.bidx} and x.employee_id <> ${e.id}::uuid`.execute(tx)).rows;
        if (shared.length) {
          if (!b.sharedAccountRemarks) return fail(`This account is also used by ${shared.map((s) => s.no).join(', ')}. Add remarks to continue.`, { 'bank.sharedAccountRemarks': 'Remarks are required for a shared account (EC-EMP-12).' });
          warnings.push(`Account shared with ${shared.map((s) => s.no).join(', ')}.`);
        }
      }
      const asnb = b.asnbAccountNo ? protectIdentifier(b.asnbAccountNo, REF.asnb(id), 'asnb') : null;
      await sql`insert into app.employee_bank_accounts (id, employee_id, payment_method, bank_id, account_type, account_no_enc, account_no_last4, account_no_bidx,
                  account_holder_name, holder_name_mismatch_ack, shared_account_remarks, proof_file_id, effective_from, verified_by,
                  asnb_account_no_enc, asnb_account_no_last4)
                values (${id}::uuid, ${e.id}::uuid, ${b.paymentMethod}::app.payment_method, ${b.bankId}::uuid, ${b.accountType}::app.bank_account_type,
                  ${acc?.enc ?? null}, ${acc?.last4 ?? null}, ${acc?.bidx ?? null}, ${b.paymentMethod === 'bank_transfer' ? b.accountHolderName : null},
                  ${b.holderNameMismatchAck}, ${b.sharedAccountRemarks}, ${b.proofFileId}::uuid, ${b.effectiveFrom ?? today}::date, app.current_app_user_id(),
                  ${asnb?.enc ?? null}, ${asnb?.last4 ?? null})`.execute(tx);
      if (b.proofFileId) {
        // the proof is also filed as an HR-only document (K1 "Bank proof")
        await sql`insert into app.employee_documents (employee_id, category, title, file_id, document_date, visible_to_employee)
                  select ${e.id}::uuid, 'bank_proof', ${`Bank proof (from ${dmy(b.effectiveFrom ?? today)})`}, ${b.proofFileId}::uuid, ${b.effectiveFrom ?? today}::date, false
                   where not exists (select 1 from app.employee_documents where file_id = ${b.proofFileId}::uuid)`.execute(tx);
      }
      return { bankAccountId: id, notified: true, warnings };
    });
  }, { effectiveFrom: 'bank.effectiveFrom', proofFileId: 'bank.proofFileId' });
}

// ===========================================================================
// E10 Reveal (logged before decryption — FR-G-11, BR-ADM-21)
// ===========================================================================
type Cipher = { enc: Buffer; ref: FieldRef; category: 'identity' | 'bank' | 'family'; format: (v: string) => string };
async function cipherFor(tx: Tx, employeeId: string, field: string, rowId: string | null | undefined): Promise<Cipher | null> {
  if (field === 'nric') {
    const r = (await sql<{ e: Buffer }>`select nric_enc as e from app.employee_personal where employee_id = ${employeeId}::uuid`.execute(tx)).rows[0];
    return r ? { enc: r.e, ref: REF.nric(employeeId), category: 'identity', format: formatMykad } : null;
  }
  if (field === 'spouse_nric' && rowId) {
    const r = (await sql<{ e: Buffer }>`select nric_enc as e from app.employee_spouses where id = ${rowId}::uuid and employee_id = ${employeeId}::uuid`.execute(tx)).rows[0];
    return r ? { enc: r.e, ref: REF.spouse(rowId), category: 'family', format: formatMykad } : null;
  }
  if (field === 'child_nric' && rowId) {
    const r = (await sql<{ e: Buffer | null }>`select nric_enc as e from app.employee_children where id = ${rowId}::uuid and employee_id = ${employeeId}::uuid`.execute(tx)).rows[0];
    return r?.e ? { enc: r.e, ref: REF.child(rowId), category: 'family', format: formatMykad } : null;
  }
  if (field === 'bank_account_no' || field === 'asnb_account_no') {
    const r = (await sql<{ id: string; a: Buffer | null; s: Buffer | null }>`
      select id, account_no_enc as a, asnb_account_no_enc as s from app.employee_bank_accounts where employee_id = ${employeeId}::uuid
        and ${rowId ? sql`id = ${rowId}::uuid` : sql`effective_from <= app.today_myt()`} order by effective_from desc limit 1`.execute(tx)).rows[0];
    if (!r) return null;
    const enc = field === 'bank_account_no' ? r.a : r.s;
    return enc ? { enc, ref: field === 'bank_account_no' ? REF.bank(r.id) : REF.asnb(r.id), category: 'bank', format: (v) => v } : null;
  }
  return null;
}

export async function revealEmployeeValue(input: Input): Promise<ActionResult<RevealResult>> {
  return runAction(ADMIN, revealEmployeeValueSchema, input, async (d, { user, ctx }) => {
    const isSa = hasRole(user, 'SA');
    if (!isSa && !d.reasonCode) return fail('Select the reason for revealing this value.', { reasonCode: 'A reason is required.' });
    if (d.reasonCode === 'other' && !d.reasonText) return fail('Describe the reason.', { reasonText: 'Describe the reason.' });
    const reason = d.reasonCode ? `${REVEAL_REASON_LABELS[d.reasonCode]}${d.reasonText ? ` — ${d.reasonText}` : ''}` : d.reasonText ?? 'Super Admin reveal';
    return withUserTx({ ...ctx, reason }, async (tx) => {
      const c = await cipherFor(tx, d.employeeId, d.field, d.rowId);
      if (!c) return NOT_FOUND;
      await writeAccess(tx, { action: 'reveal', entityType: 'employee', entityId: d.employeeId, employeeIds: [d.employeeId], fields: [d.field], categories: [c.category], reason });
      return { value: c.format(fieldCrypto.decrypt(c.enc, c.ref)) };
    });
  });
}

export async function revealMyValue(input: Input): Promise<ActionResult<RevealResult>> {
  return runAction(ANY, revealMyValueSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const me = await currentEmployeeId(tx);
      if (!me) return NOT_FOUND;
      const c = await cipherFor(tx, me, d.field, d.rowId);
      if (!c) return NOT_FOUND;
      await writeAccess(tx, { action: 'reveal', entityType: 'employee', entityId: me, employeeIds: [me], fields: [d.field], categories: [c.category], reason: 'Own record' });
      return { value: c.format(fieldCrypto.decrypt(c.enc, c.ref)) };
    }));
}

// ===========================================================================
// E11 Files & documents
// ===========================================================================
export async function requestEmployeeFileUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return runAction(ANY, requestEmployeeFileUploadSchema, input, async (d, { user, ctx, accessToken }) => {
    if (d.purpose !== 'photo' && !(user.mfaVerified && hasRole(user, 'ADM', 'SA'))) return NOT_FOUND;
    return requestUpload(ctx, accessToken, {
      subject: d.purpose === 'photo' ? 'employee_photo' : 'employee_document', ownerEmployeeId: d.employeeId,
      scope: d.purpose === 'bank_proof' ? 'bank' : d.purpose === 'document' ? 'd' : '', originalName: d.fileName, mimeType: d.mimeType,
      sizeBytes: d.sizeBytes, dataCategory: d.purpose === 'bank_proof' ? 'bank' : null,
    });
  }, { fileId: 'fileName' });
}

export async function confirmEmployeeFileUpload(input: Input): Promise<ActionResult<{ fileId: string }>> {
  return runAction(ANY, fileIdSchema, input, async (d, { ctx, accessToken }) => {
    await confirmUpload(ctx, accessToken, d.fileId);
    return { fileId: d.fileId };
  });
}

export async function createDocument(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, createDocumentSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (await isOwn(tx, d.employeeId)) return fail('Documents on your own record are uploaded by another Admin.');
      const r = await sql<{ id: string }>`insert into app.employee_documents (employee_id, category, title, file_id, document_date, expiry_date, visible_to_employee, remarks)
          values (${d.employeeId}::uuid, ${d.category}::app.document_category, ${d.title}, ${d.fileId}::uuid, ${d.documentDate}::date, ${d.expiryDate}::date,
            ${d.visibleToEmployee}, ${d.remarks}) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function updateDocument(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updateDocumentSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const cur = (await sql<{ employee_id: string; version: number }>`select employee_id, version from app.employee_documents where id = ${d.id}::uuid for update`.execute(tx)).rows[0];
      if (!cur) return NOT_FOUND;
      if (cur.version !== d.version) return fail('This document was updated by someone else — refresh and try again.');
      if (d.replaceFileId) {
        const r = await sql<{ id: string }>`insert into app.employee_documents (employee_id, category, title, file_id, document_date, expiry_date,
            visible_to_employee, remarks, replaces_document_id)
          values (${cur.employee_id}::uuid, ${d.category}::app.document_category, ${d.title}, ${d.replaceFileId}::uuid, ${d.documentDate}::date,
            ${d.expiryDate}::date, ${d.visibleToEmployee}, ${d.remarks}, ${d.id}::uuid) returning id`.execute(tx);
        await sql`update app.employee_documents set is_active = false where id = ${d.id}::uuid`.execute(tx);
        return { id: r.rows[0]!.id };
      }
      await sql`update app.employee_documents set category = ${d.category}::app.document_category, title = ${d.title}, document_date = ${d.documentDate}::date,
                  expiry_date = ${d.expiryDate}::date, visible_to_employee = ${d.visibleToEmployee}, remarks = ${d.remarks} where id = ${d.id}::uuid`.execute(tx);
      return { id: d.id };
    }));
}

export async function setDocumentActive(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, setDocumentActiveSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update app.employee_documents set is_active = ${d.isActive} where id = ${d.id}::uuid`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }));
}

export async function getDocumentDownloadUrl(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(ANY, documentIdSchema, input, async (d, { ctx, accessToken }) => {
    const doc = await withUserTx(ctx, async (tx) =>
      (await sql<{ file_id: string }>`select file_id from app.employee_documents where id = ${d.id}::uuid`.execute(tx)).rows[0]);
    if (!doc) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, doc.file_id, { purpose: 'download' });
  });
}

export async function getEmployeeFileUrl(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(ADMIN, z.object({ employeeId: z.uuid(), fileId: z.uuid() }), input, async (d, { ctx, accessToken }) => {
    const ok = await withUserTx(ctx, async (tx) =>
      (await sql<{ id: string }>`select id from app.files where id = ${d.fileId}::uuid and owner_employee_id = ${d.employeeId}::uuid`.execute(tx)).rows[0]);
    if (!ok) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, d.fileId, { purpose: 'view' });
  });
}

export async function exportEmployeeDocumentsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, documentListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await documentRows(tx, p, true);
      await writeAccess(tx, { action: 'export', entityType: 'employee_documents', employeeIds: [p.employeeId], recordCount: rows.length });
      return csvFile('employee-documents', ['Title', 'Category', 'Document date', 'Expiry', 'Visible to employee', 'Uploaded by', 'Uploaded at', 'Active'],
        rows.map((r) => [r.title, DOCUMENT_CATEGORY_LABELS[r.category], csvDate(r.documentDate), csvDate(r.expiryDate), r.visibleToEmployee,
          r.uploadedByName, csvDateTime(r.uploadedAt), r.isActive]));
    }));
}

// ===========================================================================
// E16 HR notes, L2 prior employment
// ===========================================================================
export async function createHrNote(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, createHrNoteSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`insert into app.hr_notes (employee_id, note_date, body) values (${d.employeeId}::uuid, ${d.noteDate}::date, ${d.body}) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function updateHrNote(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, updateHrNoteSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update app.hr_notes set note_date = ${d.noteDate}::date, body = ${d.body} where id = ${d.id}::uuid and version = ${d.version}`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : fail('This note was changed by someone else — refresh and try again.');
    }));
}

export async function savePriorEmployment(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ANY, savePriorEmploymentSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      if (d.id) {
        const r = await sql`update app.prior_employments set employer = ${d.employer}, position = ${d.position}, date_from = ${d.dateFrom}::date,
            date_to = ${d.dateTo}::date where id = ${d.id}::uuid and employee_id = ${d.employeeId}::uuid`.execute(tx);
        return Number(r.numAffectedRows ?? 0) ? { id: d.id } : NOT_FOUND;
      }
      const r = await sql<{ id: string }>`insert into app.prior_employments (employee_id, employer, position, date_from, date_to)
          values (${d.employeeId}::uuid, ${d.employer}, ${d.position}, ${d.dateFrom}::date, ${d.dateTo}::date) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function deletePriorEmployment(input: Input): Promise<ActionResult> {
  return runAction(ANY, deletePriorEmploymentSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`delete from app.prior_employments where id = ${d.id}::uuid`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }));
}

// ===========================================================================
// E12/E13 Change requests — HR side
// ===========================================================================
export async function exportChangeRequestsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, changeRequestListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await changeRequestRows(tx, p, false, true);
      await exported(tx, 'change_requests', rows.length);
      return csvFile('change-requests', ['CR no.', 'Employee no.', 'Employee', 'Category', 'Submitted at', 'Effective date', 'Status', 'Attachments', 'Decided by', 'Decided at'],
        rows.map((r) => [r.crNo, r.employee.employeeNo, r.employee.name, CR_CATEGORY_LABELS[r.category], csvDateTime(r.submittedAt), csvDate(r.effectiveDate),
          CR_STATUS_LABELS[r.status], r.attachmentCount, r.decidedByName, csvDateTime(r.decidedAt)]));
    }));
}

export async function decideChangeRequest(input: Input): Promise<ActionResult<DecideChangeRequestResult>> {
  return runAction(ADMIN, decideChangeRequestSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.remarks ?? ctx.reason }, async (tx) => {
      const s = (await sql<{ s: 'approved' | 'rejected' }>`select app.decide_change_request(${d.id}::uuid, ${d.decision}, ${d.remarks}, ${d.version})::text as s`.execute(tx)).rows[0]!.s;
      const c = (await sql<{ applied_at: Date | null; effective_date: string }>`select applied_at, effective_date from app.change_requests where id = ${d.id}::uuid`.execute(tx)).rows[0]!;
      return { status: s, applied: !!c.applied_at, appliesOn: s === 'approved' && !c.applied_at ? c.effective_date : null };
    }));
}

const S1_COLUMN: Record<string, string> = { nric: 'nric_enc', account_no: 'account_no_enc', asnb_account_no: 'asnb_account_no_enc' };
export async function revealChangeRequestValue(input: Input): Promise<ActionResult<RevealResult>> {
  return runAction(ANY, revealChangeRequestValueSchema, input, async (d, { user, ctx }) =>
    withUserTx(ctx, async (tx) => {
      const it = (await sql<{ target_table: string; target_row_id: string; field_name: string; new_value_enc: Buffer | null; employee_id: string; status: string; cr_no: string; cr_id: string }>`
        select i.target_table, i.target_row_id, i.field_name, i.new_value_enc, i.employee_id, c.status::text as status, c.cr_no, c.id as cr_id
          from app.change_request_items i join app.change_requests c on c.id = i.change_request_id where i.id = ${d.itemId}::uuid`.execute(tx)).rows[0];
      if (!it || !it.new_value_enc || !S1_COLUMN[it.field_name]) return NOT_FOUND;
      const own = (await currentEmployeeId(tx)) === it.employee_id;
      const admin = user.mfaVerified && hasRole(user, 'ADM', 'SA');
      if (own ? it.status !== 'submitted' : !admin) return NOT_FOUND;
      if (!own && !hasRole(user, 'SA') && !d.reasonCode) return fail('Select the reason for revealing this value.', { reasonCode: 'A reason is required.' });
      const reason = own ? 'Own change request' : d.reasonCode ? `${REVEAL_REASON_LABELS[d.reasonCode]}${d.reasonText ? ` — ${d.reasonText}` : ''}` : d.reasonText ?? 'Super Admin reveal';
      await writeAccess(tx, { action: 'reveal', entityType: 'change_request', entityId: it.cr_id, entityRef: it.cr_no, employeeIds: [it.employee_id],
        fields: [it.field_name], categories: [it.field_name === 'nric' ? (it.target_table === 'employee_personal' ? 'identity' : 'family') : 'bank'], reason });
      const v = fieldCrypto.decrypt(it.new_value_enc, { table: it.target_table, column: S1_COLUMN[it.field_name]!, rowId: it.target_row_id });
      return { value: it.field_name === 'nric' ? formatMykad(v) : v };
    }));
}

export async function getChangeRequestFileUrl(input: Input): Promise<ActionResult<{ url: string; fileName: string }>> {
  return runAction(ANY, changeRequestFileSchema, input, async (d, { ctx, accessToken }) => {
    const ok = await withUserTx(ctx, async (tx) =>
      (await sql<{ ok: number }>`select 1 as ok from app.change_request_files where change_request_id = ${d.changeRequestId}::uuid and file_id = ${d.fileId}::uuid`.execute(tx)).rows[0]);
    if (!ok) return NOT_FOUND;
    return getDownloadUrl(ctx, accessToken, d.fileId, { purpose: 'approve_review' });
  });
}

// ===========================================================================
// P17/P18 Change requests — employee side
// ===========================================================================
export async function requestChangeRequestUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return runAction(ANY, requestChangeRequestUploadSchema, input, async (d, { ctx, accessToken }) => {
    const me = await withUserTx(ctx, (tx) => currentEmployeeId(tx));
    if (!me) return fail('Your employee record has not been created yet.');
    return requestUpload(ctx, accessToken, { subject: 'change_request_doc', ownerEmployeeId: me, scope: 'pending', originalName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes });
  }, { fileId: 'fileName' });
}

export async function confirmChangeRequestUpload(input: Input): Promise<ActionResult<{ fileId: string }>> {
  return confirmEmployeeFileUpload(input);
}

type Item = { target_table: string; target_row_id: string; field_name: string; field_label: string; group_label: string | null; op: 'update' | 'insert' | 'remove';
  current_display: string | null; new_value: unknown; enc?: { enc: Buffer; last4: string; bidx: Buffer | null } };
const label = (f: string) => f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const text = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === 'string' ? v : String(v));

export async function submitChangeRequest(input: Input): Promise<ActionResult<SubmitChangeRequestResult>> {
  return runAction(ANY, submitChangeRequestSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const me = await currentEmployeeId(tx);
      if (!me) return fail('Your employee record has not been created yet.');
      if (d.idempotencyKey) {
        const ex = (await sql<{ id: string; cr_no: string; n: number }>`select c.id, c.cr_no, (select count(*)::int from app.change_request_items i where i.change_request_id = c.id) as n
            from app.change_requests c where c.idempotency_key = ${d.idempotencyKey}::uuid and c.employee_id = ${me}::uuid`.execute(tx)).rows[0];
        if (ex) return { id: ex.id, crNo: ex.cr_no, itemCount: ex.n, warnings: [] };
      }
      const e = await loadCore(tx, { id: me });
      if (!e) return NOT_FOUND;
      const items: Item[] = [];
      const warnings: string[] = [];
      const push = (t: string, rowId: string, field: string, cur: unknown, val: unknown, group: string | null = null, op: Item['op'] = 'update', fl?: string) => {
        if (op === 'update' && text(cur) === text(val)) return;
        items.push({ target_table: t, target_row_id: rowId, field_name: field, field_label: fl ?? label(field), group_label: group, op, current_display: text(cur), new_value: val });
      };
      const p = (await sql<Record<string, unknown>>`select date_of_birth, race::text as race, race_other from app.employee_personal where employee_id = ${me}::uuid`.execute(tx)).rows[0] ?? {};
      switch (d.category) {
        case 'legal_name': push('employees', me, 'full_name', e.full_name, d.fullName, null, 'update', 'Full name'); break;
        case 'mykad': {
          const dup = await duplicateByNric(tx, d.mykad, me);
          if (dup) return fail('This MyKad already exists on another employee record.', { mykad: 'Already exists on another record — contact HR.' });
          const enc = protectIdentifier(d.mykad, REF.nric(me), BIDX.nric);
          const cur = (await sql<{ l: string }>`select nric_last4 as l from app.employee_personal where employee_id = ${me}::uuid`.execute(tx)).rows[0]?.l;
          items.push({ target_table: 'employee_personal', target_row_id: me, field_name: 'nric', field_label: 'MyKad', group_label: null, op: 'update',
            current_display: maskMykad(cur), new_value: null, enc: { enc: enc.enc, last4: enc.last4, bidx: enc.bidx } });
          const c = checkMykad(d.mykad);
          push('employee_personal', me, 'date_of_birth', p.date_of_birth, c.dateOfBirth, null, 'update', 'Date of birth');
          push('employees', me, 'gender', e.gender, c.gender, null, 'update', 'Gender');
          break;
        }
        case 'marital_spouse': {
          const today = await todayMyt(tx);
          const cur = (await sql<{ m: string }>`select marital_status::text as m from app.employee_marital_history where employee_id = ${me}::uuid
              and effective_date <= ${today}::date order by effective_date desc limit 1`.execute(tx)).rows[0]?.m ?? null;
          if (cur !== d.maritalStatus) items.push({ target_table: 'employee_marital_history', target_row_id: randomUUID(), field_name: 'marital_status',
            field_label: 'Marital status', group_label: null, op: 'insert', current_display: cur ? MARITAL_STATUS_LABELS[cur as keyof typeof MARITAL_STATUS_LABELS] : null, new_value: d.maritalStatus });
          let n = 0;
          for (const s of d.spouses) {
            n += 1;
            const id = s.id ?? randomUUID();
            const old = s.id ? (await sql<Record<string, unknown>>`select full_name, nric_last4, marriage_date, working_status, is_oku, income_tax_no,
                relief_claimed_by_employee, record_status::text as record_status from app.employee_spouses where id = ${s.id}::uuid and employee_id = ${me}::uuid`.execute(tx)).rows[0] : {};
            if (s.id && !old) return fail('A spouse record could not be found — refresh and try again.');
            const op: Item['op'] = s.id ? 'update' : 'insert';
            const g = `Spouse ${n}${s.id ? '' : ' (new)'} · ${s.fullName}`;
            const vals: Record<string, unknown> = { full_name: s.fullName, marriage_date: s.marriageDate, working_status: s.workingStatus, is_oku: s.isOku,
              income_tax_no: s.incomeTaxNo, relief_claimed_by_employee: s.reliefClaimedByEmployee, record_status: s.recordStatus };
            for (const [k, v] of Object.entries(vals)) push('employee_spouses', id, k, old?.[k] ?? null, v, g, op);
            if (s.mykad) {
              const enc = protectIdentifier(s.mykad, REF.spouse(id), BIDX.spouse);
              items.push({ target_table: 'employee_spouses', target_row_id: id, field_name: 'nric', field_label: 'Spouse MyKad', group_label: g, op,
                current_display: maskMykad(old?.nric_last4 as string | undefined), new_value: null, enc: { enc: enc.enc, last4: enc.last4, bidx: enc.bidx } });
            }
          }
          break;
        }
        case 'children': {
          let n = 0;
          for (const c of d.children) {
            n += 1;
            const id = c.id ?? randomUUID();
            const old = c.id ? (await sql<Record<string, unknown>>`select full_name, nric_last4, date_of_birth, gender::text as gender, relationship::text as relationship,
                pcb_category::text as pcb_category, relief_share::text as relief_share, institution_level, is_oku from app.employee_children
                where id = ${c.id}::uuid and employee_id = ${me}::uuid`.execute(tx)).rows[0] : {};
            if (c.id && !old) return fail('A child record could not be found — refresh and try again.');
            const g = `Child ${n}${c.id ? '' : ' (new)'} · ${c.fullName}`;
            if (c.op === 'remove' && c.id) {
              items.push({ target_table: 'employee_children', target_row_id: id, field_name: '*', field_label: 'Remove child', group_label: g, op: 'remove', current_display: c.fullName, new_value: null });
              continue;
            }
            const op: Item['op'] = c.id ? 'update' : 'insert';
            const vals: Record<string, unknown> = { full_name: c.fullName, date_of_birth: c.dateOfBirth, gender: c.gender, relationship: c.relationship,
              pcb_category: c.pcbCategory, relief_share: c.reliefShare, institution_level: c.institutionLevel, is_oku: c.isOku };
            for (const [k, v] of Object.entries(vals)) push('employee_children', id, k, old?.[k] ?? null, v, g, op);
            if (c.mykad) {
              const enc = protectIdentifier(c.mykad, REF.child(id), BIDX.child);
              items.push({ target_table: 'employee_children', target_row_id: id, field_name: 'nric', field_label: 'MyKid / MyKad', group_label: g, op,
                current_display: maskMykad(old?.nric_last4 as string | undefined), new_value: null, enc: { enc: enc.enc, last4: enc.last4, bidx: enc.bidx } });
            }
          }
          break;
        }
        case 'oku': case 'religion': {
          const s = (await sql<Record<string, unknown>>`select religion::text as religion, is_oku, oku_card_no from app.employee_sensitive where employee_id = ${me}::uuid`.execute(tx)).rows[0] ?? {};
          if (d.category === 'oku') { push('employee_sensitive', me, 'is_oku', s.is_oku, d.isOku, null, 'update', 'OKU'); push('employee_sensitive', me, 'oku_card_no', s.oku_card_no, d.isOku ? d.okuCardNo : null, null, 'update', 'OKU card no.'); }
          else push('employee_sensitive', me, 'religion', s.religion ? RELIGION_LABELS[s.religion as keyof typeof RELIGION_LABELS] : null, d.religion, null, 'update', 'Religion');
          break;
        }
        case 'race':
          push('employee_personal', me, 'race', p.race, d.race, null, 'update', 'Race');
          push('employee_personal', me, 'race_other', p.race_other, d.race === 'others' ? d.raceOther : null, null, 'update', 'Race (other)');
          break;
        case 'bank_details': {
          if (d.paymentMethod === 'bank_transfer' && norm(d.accountHolderName) !== norm(e.full_name)) {
            if (!d.holderNameMismatchAck) return fail("Holder name differs from your name — joint or third-party accounts are discouraged.", { holderNameMismatchAck: 'Tick "Continue anyway" to submit.' });
            warnings.push("Holder name differs from the employee's name.");
          }
          const today = await todayMyt(tx);
          const cur = (await sql<{ payment_method: string; bank: string | null; account_type: string | null; account_no_last4: string | null; account_holder_name: string | null; asnb: string | null }>`
            select b.payment_method::text as payment_method, k.name as bank, b.account_type::text as account_type, b.account_no_last4, b.account_holder_name,
                   b.asnb_account_no_last4 as asnb
              from app.employee_bank_accounts b left join app.banks k on k.id = b.bank_id where b.employee_id = ${me}::uuid and b.effective_from <= ${today}::date
             order by b.effective_from desc limit 1`.execute(tx)).rows[0];
          const id = randomUUID();
          const bankName = d.bankId ? (await sql<{ n: string }>`select name as n from app.banks where id = ${d.bankId}::uuid`.execute(tx)).rows[0]?.n ?? null : null;
          const add = (f: string, fl: string, curDisp: string | null, v: unknown) =>
            items.push({ target_table: 'employee_bank_accounts', target_row_id: id, field_name: f, field_label: fl, group_label: null, op: 'insert', current_display: curDisp, new_value: v });
          add('payment_method', 'Payment method', cur?.payment_method ?? null, d.paymentMethod);
          if (d.paymentMethod === 'bank_transfer') {
            add('bank_id', 'Bank', cur?.bank ?? null, d.bankId);
            add('account_type', 'Account type', cur?.account_type ?? null, d.accountType);
            add('account_holder_name', 'Account holder name', cur?.account_holder_name ?? null, d.accountHolderName);
            add('holder_name_mismatch_ack', 'Holder name differs (acknowledged)', null, d.holderNameMismatchAck);
            const acc = protectIdentifier(d.accountNo!, REF.bank(id), BIDX.bank);
            items.push({ target_table: 'employee_bank_accounts', target_row_id: id, field_name: 'account_no', field_label: 'Account no.', group_label: null, op: 'insert',
              current_display: maskAccount(cur?.account_no_last4), new_value: null, enc: { enc: acc.enc, last4: acc.last4, bidx: acc.bidx } });
          }
          if (d.asnbAccountNo) {
            const a = protectIdentifier(d.asnbAccountNo, REF.asnb(id), 'asnb');
            items.push({ target_table: 'employee_bank_accounts', target_row_id: id, field_name: 'asnb_account_no', field_label: 'ASNB account no.', group_label: null, op: 'insert',
              current_display: maskAccount(cur?.asnb), new_value: null, enc: { enc: a.enc, last4: a.last4, bidx: null } });
          }
          if (bankName) items.find((x) => x.field_name === 'bank_id')!.field_label = `Bank (${bankName})`;
          break;
        }
        case 'statutory_numbers': {
          const s = (await sql<Record<string, unknown>>`select income_tax_no, lhdn_branch_id, epf_no, epf_rate_type::text as epf_rate_type, epf_specific_rate,
              epf_extra_employee_pct, socso_contributed_before, pay_zakat, zakat_monthly_amount, zakat_account_no, zakat_body_id, ptptn_monthly_amount,
              ptptn_start_date, ptptn_end_date from app.employee_statutory_profiles where employee_id = ${me}::uuid`.execute(tx)).rows[0] ?? {};
          const vals: Record<string, unknown> = { income_tax_no: d.incomeTaxNo, lhdn_branch_id: d.lhdnBranchId, epf_no: d.epfNo, epf_rate_type: d.epfRateType,
            epf_specific_rate: d.epfRateType === 'specific' ? d.epfSpecificRate : null, epf_extra_employee_pct: d.epfExtraEmployeePct,
            socso_contributed_before: d.socsoContributedBefore, pay_zakat: d.payZakat, zakat_monthly_amount: d.payZakat ? d.zakatMonthlyAmount : null,
            zakat_account_no: d.payZakat ? d.zakatAccountNo : null, zakat_body_id: d.zakatBodyId, ptptn_monthly_amount: d.ptptnMonthlyAmount,
            ptptn_start_date: d.ptptnStartDate, ptptn_end_date: d.ptptnEndDate };
          for (const [k, v] of Object.entries(vals)) push('employee_statutory_profiles', me, k, s[k] ?? null, v);
          break;
        }
      }
      if (items.length === 0) return fail('Nothing to change — the new values are the same as the current ones.');
      const cr = (await sql<{ id: string; cr_no: string }>`insert into app.change_requests (employee_id, category, effective_date, employee_remarks, idempotency_key)
          values (${me}::uuid, ${d.category}::app.cr_category, ${d.effectiveDate}::date, ${d.remarks}, ${d.idempotencyKey ?? null}::uuid) returning id, cr_no`.execute(tx)).rows[0]!;
      for (const i of items) {
        await sql`insert into app.change_request_items (change_request_id, employee_id, target_table, target_row_id, op, field_name, field_label, group_label,
                    current_display, new_value, new_value_enc, new_value_last4, new_value_bidx)
                  values (${cr.id}::uuid, ${me}::uuid, ${i.target_table}, ${i.target_row_id}::uuid, ${i.op}, ${i.field_name}, ${i.field_label.slice(0, 100)},
                    ${i.group_label ? i.group_label.slice(0, 100) : null}, ${i.current_display ? i.current_display.slice(0, 300) : null},
                    ${i.enc ? null : JSON.stringify(i.new_value ?? null)}::jsonb, ${i.enc?.enc ?? null}, ${i.enc?.last4 ?? null}, ${i.enc?.bidx ?? null})`.execute(tx);
      }
      for (const f of [...new Set(d.fileIds)]) {
        await sql`insert into app.change_request_files (change_request_id, file_id) values (${cr.id}::uuid, ${f}::uuid)`.execute(tx);
      }
      return { id: cr.id, crNo: cr.cr_no, itemCount: items.length, warnings };
    }), { category: 'category', mykad: 'mykad' });
}

export async function cancelChangeRequest(input: Input): Promise<ActionResult> {
  return runAction(ANY, changeRequestIdSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update app.change_requests set status = 'cancelled' where id = ${d.id}::uuid and status = 'submitted'
          and employee_id = app.current_employee_id()`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }));
}

export async function exportMyChangeRequestsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, changeRequestListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await changeRequestRows(tx, p, true, true);
      await exported(tx, 'my_change_requests', rows.length);
      return csvFile('my-change-requests', ['CR no.', 'Category', 'Submitted at', 'Effective date', 'Status', 'Decided at'],
        rows.map((r) => [r.crNo, CR_CATEGORY_LABELS[r.category], csvDateTime(r.submittedAt), csvDate(r.effectiveDate), CR_STATUS_LABELS[r.status], csvDateTime(r.decidedAt)]));
    }));
}

// ===========================================================================
// P16 Self-update (E✎ only; N-40 to Admins by trigger)
// ===========================================================================
async function myId(tx: Tx): Promise<string | null> {
  const me = await currentEmployeeId(tx);
  return me && (await loadCore(tx, { id: me })) ? me : null;
}
export async function updateMyPersonal(input: Input): Promise<ActionResult> {
  return runAction(ANY, updateMyPersonalSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const me = await myId(tx);
      if (!me) return fail('Your employee record has not been created yet.');
      await sql`update app.employees set preferred_name = ${d.preferredName} where id = ${me}::uuid`.execute(tx);
      await sql`update app.employee_personal set passport_no = ${d.passportNo}, passport_expiry = ${d.passportExpiry}::date,
                  highest_qualification = ${d.highestQualification}::app.qualification where employee_id = ${me}::uuid`.execute(tx);
      return {};
    }));
}
export async function updateMyContact(input: Input): Promise<ActionResult> {
  return runAction(ANY, updateMyContactSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const me = await myId(tx);
      if (!me) return fail('Your employee record has not been created yet.');
      await sql`update app.employees set mobile_phone = ${d.mobilePhone} where id = ${me}::uuid`.execute(tx);
      await updateAddress(tx, me, d);
      return {};
    }));
}
export async function saveMyEmergencyContacts(input: Input): Promise<ActionResult> {
  return runAction(ANY, saveMyEmergencyContactsSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const me = await myId(tx);
      if (!me) return fail('Your employee record has not been created yet.');
      await sql`delete from app.employee_emergency_contacts where employee_id = ${me}::uuid`.execute(tx);
      await insertContacts(tx, me, d.contacts);
      return {};
    }));
}
export async function updateMySpousePhone(input: Input): Promise<ActionResult> {
  return runAction(ANY, updateMySpousePhoneSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update app.employee_spouses set phone = ${d.phone} where id = ${d.spouseId}::uuid and employee_id = app.current_employee_id()`.execute(tx);
      return Number(r.numAffectedRows ?? 0) ? {} : NOT_FOUND;
    }));
}

export async function exportMyDocumentsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, myDocumentListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await myDocumentRows(tx, p, true);
      await exported(tx, 'my_documents', rows.length);
      return csvFile('my-documents', ['Title', 'Category', 'Document date', 'Expiry', 'Uploaded at'],
        rows.map((r) => [r.title, DOCUMENT_CATEGORY_LABELS[r.category], csvDate(r.documentDate), csvDate(r.expiryDate), csvDateTime(r.uploadedAt)]));
    }));
}

// ===========================================================================
// P31/P33 Manager
// ===========================================================================
export async function exportMyTeamCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(TEAM, myTeamParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await teamRows(tx, p, true);
      await exported(tx, 'my_team', rows.length);
      return csvFile('my-team', ['Employee no.', 'Name', 'Preferred name', 'Position', 'Department', 'Status', 'Direct report'],
        rows.map((r) => [r.employeeNo, r.fullName, r.preferredName, r.position.label, r.department.label, EMPLOYMENT_STATUS_LABELS[r.status], r.isDirect]));
    }));
}

export async function recordProbationRecommendation(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(TEAM, probationRecommendationSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const ok = (await sql<{ ok: boolean }>`select app.is_manager_of(${d.employeeId}::uuid) or app.is_admin() as ok`.execute(tx)).rows[0]?.ok;
      if (!ok) return NOT_FOUND;
      const r = await sql<{ id: string }>`insert into app.probation_recommendations (employee_id, recommendation, suggested_extension_months, remarks, recommended_by)
          values (${d.employeeId}::uuid, ${d.recommendation}, ${d.recommendation === 'extend' ? d.suggestedExtensionMonths : null}, ${d.remarks},
            app.current_app_user_id()) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

// ===========================================================================
// E14 Bulk update via CSV
// ===========================================================================
type Resolved = { employeeId: string; employeeNo: string; name: string; job: Partial<Record<'manager' | 'department' | 'position' | 'grade' | 'work_location' | 'working_pattern', string | null>>; groups: string[] | null };
type Lookup = { id: string; key: string; label: string; active: boolean };
async function evaluateBulk(tx: Tx, d: z.output<typeof bulkUpdateSchema>): Promise<{ preview: BulkUpdatePreview; resolved: Resolved[] }> {
  const parsed = parseBulkUpdateCsv(d.csv, d.fields);
  const rows: BulkUpdatePreviewRow[] = parsed.errors.map((e) => ({ rowNo: e.rowNo, employeeNo: e.employeeNo, employeeName: null, field: null, current: null, requested: null, result: 'error', message: e.message }));
  const look = async (q: ReturnType<typeof sql>) => (await sql<Lookup>`${q}`.execute(tx)).rows;
  const deps = new Map((await look(sql`select id, upper(code) as key, name as label, is_active as active from app.departments`)).map((x) => [x.key, x]));
  const poss = new Map((await look(sql`select id, upper(code) as key, title as label, is_active as active from app.positions`)).map((x) => [x.key, x]));
  const grds = new Map((await look(sql`select id, upper(code) as key, name as label, is_active as active from app.grades`)).map((x) => [x.key, x]));
  const locs = new Map((await look(sql`select id, lower(name) as key, name as label, is_active as active from app.work_locations`)).map((x) => [x.key, x]));
  const pats = new Map((await look(sql`select id, lower(name) as key, name as label, is_active as active from app.working_patterns`)).map((x) => [x.key, x]));
  const grps = new Map((await look(sql`select id, lower(name) as key, name as label, is_active as active from app.employee_groups`)).map((x) => [x.key, x]));
  const emps = (await sql<{ id: string; employee_no: string; full_name: string; status: string; manager_employee_id: string | null; department_id: string; position_id: string; grade_id: string; work_location_id: string; working_pattern_id: string; mgr_no: string | null; dept: string; pos: string; grade: string; loc: string; pat: string; groups: string[] | null }>`
    select e.id, upper(e.employee_no) as employee_no, e.full_name, e.status::text as status, e.manager_employee_id, e.department_id, e.position_id, e.grade_id,
           e.work_location_id, e.working_pattern_id, m.employee_no as mgr_no, d.name as dept, p.title as pos, g.name as grade, l.name as loc, w.name as pat,
           (select array_agg(eg.name order by eg.name) from app.employee_group_members gm join app.employee_groups eg on eg.id = gm.group_id where gm.employee_id = e.id) as groups
      from app.employees e left join app.employees m on m.id = e.manager_employee_id join app.departments d on d.id = e.department_id
      join app.positions p on p.id = e.position_id join app.grades g on g.id = e.grade_id join app.work_locations l on l.id = e.work_location_id
      join app.working_patterns w on w.id = e.working_pattern_id`.execute(tx)).rows;
  const byNo = new Map(emps.map((x) => [x.employee_no, x]));
  const managerOf = new Map(emps.map((x) => [x.id, x.manager_employee_id]));
  const resolved: Resolved[] = [];
  for (const r of parsed.rows) {
    const e = byNo.get(r.employeeNo);
    if (!e) { rows.push({ rowNo: r.rowNo, employeeNo: r.employeeNo, employeeName: null, field: null, current: null, requested: null, result: 'error', message: 'Employee no. not found.' }); continue; }
    if (!ACTIVE.includes(e.status)) { rows.push({ rowNo: r.rowNo, employeeNo: r.employeeNo, employeeName: e.full_name, field: null, current: null, requested: null, result: 'error', message: `Employee is ${EMPLOYMENT_STATUS_LABELS[e.status as EmploymentStatus]}.` }); continue; }
    const res: Resolved = { employeeId: e.id, employeeNo: r.employeeNo, name: e.full_name, job: {}, groups: null };
    for (const f of d.fields) {
      const raw = (r.values[f] ?? '').trim();
      const row = (current: string | null, requested: string | null, result: BulkUpdatePreviewRow['result'], message: string | null = null) =>
        rows.push({ rowNo: r.rowNo, employeeNo: r.employeeNo, employeeName: e.full_name, field: f, current, requested, result, message });
      if (!raw && f !== 'employee_groups') { row(null, null, 'unchanged', 'Blank — no change'); continue; }
      const masters: Partial<Record<BulkUpdateField, [Map<string, Lookup>, string, string, string]>> = {
        department: [deps, raw.toUpperCase(), e.department_id, e.dept], position: [poss, raw.toUpperCase(), e.position_id, e.pos],
        grade: [grds, raw.toUpperCase(), e.grade_id, e.grade], work_location: [locs, raw.toLowerCase(), e.work_location_id, e.loc],
        working_pattern: [pats, raw.toLowerCase(), e.working_pattern_id, e.pat],
      };
      if (f === 'manager') {
        const m = byNo.get(raw.toUpperCase());
        if (!m) { row(e.mgr_no, raw, 'error', 'Manager employee no. not found.'); continue; }
        if (m.id === e.id) { row(e.mgr_no, raw, 'error', 'An employee cannot be their own manager.'); continue; }
        if (!ACTIVE.includes(m.status)) { row(e.mgr_no, raw, 'error', 'The manager must be an active employee.'); continue; }
        if (m.id === e.manager_employee_id) { row(e.mgr_no, raw, 'unchanged'); continue; }
        res.job.manager = m.id; managerOf.set(e.id, m.id); row(e.mgr_no, `${m.employee_no} ${m.full_name}`, 'ok');
      } else if (f === 'employee_groups') {
        const names = splitGroups(raw);
        const missing = names.filter((n) => !grps.get(n.toLowerCase()));
        if (missing.length) { row((e.groups ?? []).join('; '), raw, 'error', `Unknown group(s): ${missing.join(', ')}.`); continue; }
        const ids = names.map((n) => grps.get(n.toLowerCase())!.id);
        const cur = (e.groups ?? []).join('; '); const next = names.map((n) => grps.get(n.toLowerCase())!.label).sort().join('; ');
        if (cur === next) { row(cur, next, 'unchanged'); continue; }
        res.groups = ids; row(cur || null, next || '(none)', 'ok');
      } else {
        const [map, key, curId, curLabel] = masters[f]!;
        const hit = map.get(key);
        if (!hit) { row(curLabel, raw, 'error', `${BULK_UPDATE_FIELD_LABELS[f]} "${raw}" not found.`); continue; }
        if (!hit.active) { row(curLabel, hit.label, 'error', `${BULK_UPDATE_FIELD_LABELS[f]} "${hit.label}" is inactive.`); continue; }
        if (hit.id === curId) { row(curLabel, hit.label, 'unchanged'); continue; }
        (res.job as Record<string, string>)[f] = hit.id; row(curLabel, hit.label, 'ok');
      }
    }
    resolved.push(res);
  }
  // reporting-line loops after all manager changes (EC-EMP-03)
  for (const r of resolved.filter((x) => x.job.manager)) {
    const seen = new Set<string>([r.employeeId]);
    let cur = managerOf.get(r.employeeId) ?? null; let loop = false;
    while (cur) { if (seen.has(cur)) { loop = true; break; } seen.add(cur); cur = managerOf.get(cur) ?? null; }
    if (loop) {
      const pr = rows.find((x) => x.employeeNo === r.employeeNo && x.field === 'manager');
      if (pr) { pr.result = 'error'; pr.message = 'Reporting line would create a loop.'; }
      delete r.job.manager;
    }
  }
  const errors = rows.filter((x) => x.result === 'error').length;
  const changes = rows.filter((x) => x.result === 'ok').length;
  rows.sort((a, b) => a.rowNo - b.rowNo);
  return {
    preview: { rows, totalRows: parsed.rows.length, valid: parsed.rows.length - new Set(rows.filter((x) => x.result === 'error').map((x) => x.rowNo)).size,
      errors, warnings: parsed.warnings.length, changes },
    resolved,
  };
}

export async function downloadBulkUpdateTemplate(input: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, bulkTemplateSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ employee_no: string; mgr: string | null; dept: string; pos: string; grade: string; loc: string; pat: string; groups: string | null }>`
        select e.employee_no, m.employee_no as mgr, d.code as dept, p.code as pos, g.code as grade, l.name as loc, w.name as pat,
               (select string_agg(eg.name, '; ' order by eg.name) from app.employee_group_members gm join app.employee_groups eg on eg.id = gm.group_id where gm.employee_id = e.id) as groups
          from app.employees e left join app.employees m on m.id = e.manager_employee_id join app.departments d on d.id = e.department_id
          join app.positions p on p.id = e.position_id join app.grades g on g.id = e.grade_id join app.work_locations l on l.id = e.work_location_id
          join app.working_patterns w on w.id = e.working_pattern_id
         where e.status in ('pending_join','on_probation','confirmed','notice_period')
           and ${d.employeeIds?.length ? sql`e.id = any(${d.employeeIds}::uuid[])` : sql`true`}
         order by e.employee_no`.execute(tx);
      await exported(tx, 'employees_bulk_template', r.rows.length);
      const val: Record<BulkUpdateField, (x: typeof r.rows[number]) => string | null> = {
        manager: (x) => x.mgr, department: (x) => x.dept, position: (x) => x.pos, grade: (x) => x.grade, work_location: (x) => x.loc,
        working_pattern: (x) => x.pat, employee_groups: (x) => x.groups,
      };
      return csvFile('employee-bulk-update', [EMPLOYEE_NO_HEADER, ...d.fields.map((f) => BULK_UPDATE_HEADERS[f])],
        r.rows.map((x) => [x.employee_no, ...d.fields.map((f) => val[f](x))]));
    }));
}

export async function previewBulkUpdate(input: Input): Promise<ActionResult<BulkUpdatePreview>> {
  return runAction(ADMIN, bulkUpdateSchema, input, async (d, { ctx }) => withUserTx(ctx, async (tx) => (await evaluateBulk(tx, d)).preview));
}

export async function exportBulkUpdateErrorsCsv(input: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, bulkUpdateSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { preview } = await evaluateBulk(tx, d);
      const rows = preview.rows.filter((r) => r.result === 'error' || r.result === 'warning');
      return csvFile('bulk-update-errors', ['Row', 'Employee no.', 'Employee', 'Field', 'Current', 'New', 'Result', 'Message'],
        rows.map((r) => [r.rowNo, r.employeeNo, r.employeeName, r.field ? BULK_UPDATE_FIELD_LABELS[r.field] : '', r.current, r.requested, r.result, r.message]));
    }));
}

const JOB_COL: Record<string, string> = { manager: 'manager_employee_id', department: 'department_id', position: 'position_id', grade: 'grade_id', work_location: 'work_location_id', working_pattern: 'working_pattern_id' };
function changeTypeFor(job: Resolved['job']): string {
  if (job.department || job.work_location) return 'transfer';
  if (job.position) return 're_designation';
  if (job.grade) return 'grade_change';
  if (job.working_pattern) return 'working_pattern_change';
  return 'manager_change';
}
export async function commitBulkUpdate(input: Input): Promise<ActionResult<BulkUpdateCommitResult>> {
  return runAction(ADMIN, bulkUpdateSchema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.remarks ?? 'Bulk update (CSV)' }, async (tx) => {
      const { preview, resolved } = await evaluateBulk(tx, d);
      if (preview.errors > 0) return fail(`Fix the ${preview.errors} error(s) first — nothing was changed.`);
      let jobRows = 0; let groupChanges = 0; const changed = new Set<string>();
      for (const r of resolved) {
        const keys = Object.keys(r.job) as (keyof Resolved['job'])[];
        if (keys.length) {
          const cur = (await sql<Record<string, string | null> & { id: string; effective_date: string }>`select h.id, h.effective_date::text as effective_date, h.department_id, h.position_id, h.grade_id,
              h.manager_employee_id, h.work_location_id, h.working_pattern_id from app.employee_job_history h
              where h.employee_id = ${r.employeeId}::uuid and not h.is_deleted and h.effective_date <= ${d.effectiveDate}::date order by h.effective_date desc limit 1`.execute(tx)).rows[0];
          if (!cur) return fail(`${r.employeeNo}: the effective date is before the join date — nothing was changed.`);
          const v = (k: string) => (r.job as Record<string, string | null | undefined>)[k] ?? cur[JOB_COL[k]!] ?? null;
          if (cur.effective_date === d.effectiveDate) {
            await sql`update app.employee_job_history set department_id = ${v('department')}::uuid, position_id = ${v('position')}::uuid, grade_id = ${v('grade')}::uuid,
                        manager_employee_id = ${v('manager')}::uuid, work_location_id = ${v('work_location')}::uuid, working_pattern_id = ${v('working_pattern')}::uuid,
                        change_type = case when effective_date <= app.today_myt() then 'data_correction'::app.job_change_type else ${changeTypeFor(r.job)}::app.job_change_type end,
                        remarks = coalesce(${d.remarks}, remarks, 'Bulk update (CSV)') where id = ${cur.id}::uuid`.execute(tx);
          } else {
            await sql`insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id, manager_employee_id,
                        work_location_id, working_pattern_id, remarks)
                      values (${r.employeeId}::uuid, ${d.effectiveDate}::date, ${changeTypeFor(r.job)}::app.job_change_type, ${v('department')}::uuid, ${v('position')}::uuid,
                        ${v('grade')}::uuid, ${v('manager')}::uuid, ${v('work_location')}::uuid, ${v('working_pattern')}::uuid, ${d.remarks ?? 'Bulk update (CSV)'})`.execute(tx);
          }
          jobRows += 1; changed.add(r.employeeId);
        }
        if (r.groups) {
          await sql`delete from app.employee_group_members where employee_id = ${r.employeeId}::uuid and not (group_id = any(${r.groups}::uuid[]))`.execute(tx);
          for (const g of r.groups) await sql`insert into app.employee_group_members (group_id, employee_id) values (${g}::uuid, ${r.employeeId}::uuid) on conflict do nothing`.execute(tx);
          groupChanges += 1; changed.add(r.employeeId);
        }
      }
      return { employeesChanged: changed.size, jobRowsCreated: jobRows, groupChanges };
    }));
}

// ===========================================================================
// E15 Bulk actions + invite from the profile
// ===========================================================================
export async function bulkChangeManager(input: Input): Promise<ActionResult<BulkChangeManagerResult>> {
  return runAction(ADMIN, bulkChangeManagerSchema, input, async (d, { ctx }) => {
    const rows: BulkChangeManagerResult['rows'] = [];
    for (const id of [...new Set(d.employeeIds)]) {
      try {
        // one transaction per employee so a loop on one row does not undo the others (E15 "loop check per row")
        const no = await withUserTx({ ...ctx, reason: d.remarks ?? ctx.reason }, async (tx) => {
          const e = await loadCore(tx, { id });
          if (!e) throw new Error('PRET-ACC-404');
          if (id === d.managerId) throw new Error('PRET-EMP-OWN-MANAGER: an employee cannot be their own manager');
          await addManagerChange(tx, id, d.managerId, d.effectiveDate, d.remarks ?? 'Manager change (bulk)');
          return e.employee_no;
        });
        rows.push({ employeeId: id, employeeNo: no, ok: true, message: null });
      } catch (err) {
        const m = (err as Error).message ?? '';
        rows.push({ employeeId: id, employeeNo: '', ok: false,
          message: m.includes('PRET-EMP-LOOP') ? 'Reporting line would create a loop.' : m.includes('OWN-MANAGER') ? 'An employee cannot be their own manager.'
            : m.includes('PRET-ACC') ? NO_ACCESS : m.includes('MANAGER-INACTIVE') ? 'The manager must be an active employee.' : 'Could not change this employee.' });
      }
    }
    return { applied: rows.filter((r) => r.ok).length, skipped: rows.filter((r) => !r.ok).length, rows };
  });
}

async function inviteOne(tx: Tx, employeeId: string, mode: 'now' | 'scheduled', date: string | null) {
  const e = (await sql<{ employee_no: string; status: string; today: string }>`select employee_no, status::text as status, app.today_myt()::text as today
      from app.employees where id = ${employeeId}::uuid`.execute(tx)).rows[0];
  if (!e) return { skip: NO_ACCESS } as const;
  if (!ACTIVE.includes(e.status)) return { skip: 'separated or withdrawn', employeeNo: e.employee_no } as const;
  const acc = (await sql<{ user_id: string; accepted: boolean; status: string }>`select user_id, accepted, status::text as status from app.employee_portal_accounts(array[${employeeId}]::uuid[])`.execute(tx)).rows[0];
  if (acc?.accepted) return { skip: 'already active', employeeNo: e.employee_no } as const;
  if (acc && acc.status !== 'invited') return { skip: `user is ${acc.status}`, employeeNo: e.employee_no } as const;
  const sendNow = mode === 'now' || !date || date <= e.today;
  let userId = acc?.user_id ?? null; let email = ''; let displayName = '';
  if (!userId) { const u = await createEmployeeUser(tx, employeeId, sendNow ? null : date); userId = u.userId; email = u.email; displayName = u.displayName; }
  else {
    const u = (await sql<{ login_email: string; display_name: string }>`select login_email::text as login_email, display_name from app.app_users where id = ${userId}::uuid`.execute(tx)).rows[0];
    email = u?.login_email ?? ''; displayName = u?.display_name ?? '';
    if (!sendNow) await setInviteSchedule(tx, userId, date);
  }
  if (!sendNow) return { scheduled: date!, userId, employeeNo: e.employee_no } as const;
  await setInviteSchedule(tx, userId, null);
  return { inv: await createInvitation(tx, userId), userId, email, displayName, employeeNo: e.employee_no } as const;
}

export async function bulkSendInvites(input: Input): Promise<ActionResult<BulkSendInvitesResult>> {
  return runAction(ADMIN, bulkSendInvitesSchema, input, async (d, { ctx }) => {
    const out: BulkSendInvitesResult = { sent: 0, scheduled: 0, emailNotSent: 0, skipped: [] };
    for (const id of [...new Set(d.employeeIds)]) {
      try {
        const r = await withUserTx(ctx, async (tx) => ({ r: await inviteOne(tx, id, d.mode, d.scheduledSendDate ?? null), co: await companyName(tx) }));
        if ('skip' in r.r) { out.skipped.push({ employeeNo: String(r.r.employeeNo ?? ''), reason: String(r.r.skip ?? '') }); continue; }
        if ('scheduled' in r.r) { out.scheduled += 1; continue; }
        const sent = await deliverInvitation(r.r.inv, { email: r.r.email, displayName: r.r.displayName }, r.co);
        if (sent) out.sent += 1; else out.emailNotSent += 1;
      } catch {
        out.skipped.push({ employeeNo: '', reason: 'could not be invited' });
      }
    }
    return out;
  });
}

export async function inviteEmployee(input: Input): Promise<ActionResult<InviteEmployeeResult>> {
  return runAction(ADMIN, inviteEmployeeSchema, input, async (d, { ctx }) => {
    const r = await withUserTx(ctx, async (tx) => {
      if (await isOwn(tx, d.employeeId)) return { own: true } as const;
      return { r: await inviteOne(tx, d.employeeId, d.mode, d.scheduledSendDate ?? null), co: await companyName(tx) };
    });
    if ('own' in r) return fail('You cannot invite yourself.');
    if ('skip' in r.r) return fail(`This employee cannot be invited (${r.r.skip}).`);
    if ('scheduled' in r.r && r.r.scheduled) return { userId: r.r.userId, emailSent: false, scheduledFor: r.r.scheduled, message: `Invitation scheduled for ${dmy(r.r.scheduled)}.` };
    if (!('inv' in r.r) || !r.r.inv) return fail('This employee cannot be invited.');
    const sent = await deliverInvitation(r.r.inv, { email: r.r.email, displayName: r.r.displayName }, r.co);
    return { userId: r.r.userId, emailSent: sent, scheduledFor: null, message: inviteMessage(sent) };
  });
}

// ===========================================================================
// Exports: activity (SA), directory (7 columns)
// ===========================================================================
export async function exportEmployeeActivityCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(SA, activityParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      await writeAccess(tx, { action: 'export', entityType: 'employee_activity', employeeIds: [p.employeeId], recordCount: null });
      if (p.view === 'fields') {
        const { rows } = await fieldChangeRows(tx, p, true);
        return csvFile('employee-field-changes', ['Date/time', 'Section', 'Field', 'Before', 'After', 'Changed by', 'Source'],
          rows.map((r) => [csvDateTime(r.occurredAt), r.table, r.label, r.before, r.after, r.actorName, r.source]));
      }
      const { rows } = await activityRows(tx, p, true);
      return csvFile('employee-activity', ['Date/time', 'Event', 'By', 'Reference'], rows.map((r) => [csvDateTime(r.occurredAt), r.event, r.actorName, r.entityRef]));
    }));
}

export async function exportDirectoryCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ANY, directoryParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await directoryRows(tx, p, true, null, false);
      await exported(tx, 'staff_directory', rows.length, ['contact']);
      return csvFile('staff-directory', ['Name', 'Preferred name', 'Position', 'Department', 'Work location', 'Work email', 'Work phone'],
        rows.map((r) => [r.name, r.preferredName, r.position, r.department, r.location, r.workEmail, r.workPhone]));
    }));
}

// ===========================================================================
// Q-F1 / Q-F2 client-callable lookups (thin wrappers over the queries; same roles and RLS)
// ===========================================================================
export async function searchEmployeeOptions(input: Input): Promise<ActionResult<{ rows: EmployeeOption[] }>> {
  return runAction(ADMIN, employeeOptionsSchema, input, async (p, { ctx }) => ({ rows: await withUserTx(ctx, (tx) => employeeOptionRows(tx, p)) }));
}
export async function fetchJobChangeContext(input: Input): Promise<ActionResult<{ context: JobChangeContext | null }>> {
  return runAction(ADMIN, jobChangeContextSchema, input, async (p, { ctx }) =>
    ({ context: await withUserTx(ctx, (tx) => jobChangeContext(tx, p.employeeId, p.effectiveDate)) }));
}
export async function fetchSeparationPreview(input: Input): Promise<ActionResult<{ preview: SeparationPreview | null }>> {
  return runAction(ADMIN, separationPreviewSchema, input, async (p, { ctx }) =>
    ({ preview: await withUserTx(ctx, (tx) => separationPreview(tx, p.employeeId, p.noticeDate, p.lastWorkingDay ?? null)) }));
}
export async function fetchChangeRequestFormOptions(): Promise<ActionResult<ChangeRequestFormOptions>> {
  return runAction(ANY, z.object({}), {}, async (_p, { ctx }) => withUserTx(ctx, (tx) => changeRequestFormOptions(tx)));
}

// Re-exported labels used by the CSVs above (keeps tree-shaking honest)
void GENDER_LABELS; void RACE_LABELS; void DEFAULT_VISIBLE_DOCUMENT_CATEGORIES;
