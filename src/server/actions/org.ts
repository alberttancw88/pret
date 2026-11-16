'use server';

// M5 Organisation Server Actions (W2-002). Contract: src/server/contracts/org.ts.
// Every action: requireUser([...roles]) → zod-validate → withUserTx (RLS + DB guards) → audit
// (data changes by the audit.tg_log_change trigger; exports to audit.access_log) → ActionResult.

import { z } from 'zod';
import { sql, withUserTx, type Tx } from '../db';
import type { Role } from '../auth/current-user';
import { writeAccess } from '../audit';
import { fieldCrypto } from '../crypto';
import { confirmUpload, requestUpload } from '../storage';
import { fail, runAction, type Input } from '../lib/action-helpers';
import { csvDate, csvFile } from '../lib/csv';
import {
  addPatternVersionSchema, copyHolidaysSchema, costCentreInputSchema, costCentreListParamsSchema, createHolidaySchema,
  createWorkingPatternSchema, departmentInputSchema, departmentListParamsSchema, employeeGroupInputSchema, fileIdSchema,
  gradeInputSchema, gradeListParamsSchema, groupListParamsSchema, holidayListParamsSchema, idSchema, locationInputSchema,
  locationListParamsSchema, patternListParamsSchema, positionInputSchema, positionListParamsSchema,
  publishHolidayYearSchema, requestCompanyAssetUploadSchema, saveApprovalSettingsSchema, saveCompanyRegistrationSchema,
  saveCompanyStatutorySchema, saveEmployeeNumberSettingsSchema, saveEmploymentSettingsSchema, saveGlMappingsSchema,
  saveNotificationSettingsSchema, savePayingAccountSchema, saveProbationNoticeSettingsSchema, saveRetentionSettingsSchema,
  saveSignatoriesSchema, saveSignInSecuritySettingsSchema, saveZakatRegistrationsSchema, setActiveSchema,
  updateCompanyContactSchema, updateCostCentreSchema, updateDepartmentSchema, updateEmployeeGroupSchema, updateGradeSchema,
  updateHolidaySchema, updateLocationSchema, updatePositionSchema, updateWorkingPatternSchema,
  COMPULSORY_HOLIDAY_LABELS, DAY_TYPE_SHORT, HOLIDAY_TYPE_LABELS, MONTH_DAY_BASIS_LABELS, WEEKDAYS,
  type ActionResult, type CopyHolidaysResult, type CsvFile, type HolidayChangeResult, type PublishHolidayYearResult,
  type UpdateLocationResult, type UploadIntent,
} from '../contracts/org';
import { MY_STATE_LABELS } from '../contracts/common';
import {
  copyPreview, costCentreRows, departmentRows, gradeRows, groupRows, holidayRows, holidayYearSummary, locationRows,
  patternRows, positionRows,
} from '../queries/org';

const ADMIN: Role[] = ['ADM', 'SA'];
const SA: Role[] = ['SA'];
const NOT_FOUND = { ok: false as const, error: 'Not found or no access.' };

async function exported(tx: Tx, entityType: string, count: number, categories: ('contact')[] = []) {
  await writeAccess(tx, { action: 'export', entityType, recordCount: count, categories });
}
function affected(r: { numAffectedRows?: bigint }): number {
  return Number(r.numAffectedRows ?? 0);
}

// ===========================================================================
// O1 Company profile
// ===========================================================================
export async function saveCompanyRegistration(input: Input): Promise<ActionResult> {
  return runAction(SA, saveCompanyRegistrationSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const b = d.businessAddress;
      const r = d.registeredAddress;
      const exists = (await sql<{ n: number }>`select count(*)::int as n from app.company_profile where id = 1`.execute(tx)).rows[0]!.n > 0;
      if (exists) {
        await sql`update app.company_profile set legal_name = ${d.legalName},
                    biz_addr_line1 = ${b.line1}, biz_addr_line2 = ${b.line2}, biz_addr_line3 = ${b.line3}, biz_postcode = ${b.postcode},
                    biz_city = ${b.city}, biz_state = ${b.state}::app.my_state, biz_country = ${b.country}
                  where id = 1`.execute(tx);
      } else {
        await sql`insert into app.company_profile (id, legal_name, biz_addr_line1, biz_addr_line2, biz_addr_line3, biz_postcode, biz_city, biz_state, biz_country)
                  values (1, ${d.legalName}, ${b.line1}, ${b.line2}, ${b.line3}, ${b.postcode}, ${b.city}, ${b.state}::app.my_state, ${b.country})`.execute(tx);
      }
      await sql`insert into app.company_statutory as s (id, ssm_no_new, ssm_no_old, reg_addr_line1, reg_addr_line2, reg_addr_line3, reg_postcode, reg_city, reg_state, reg_country)
                values (1, ${d.ssmNoNew}, ${d.ssmNoOld}, ${r.line1}, ${r.line2}, ${r.line3}, ${r.postcode}, ${r.city}, ${r.state}::app.my_state, ${r.country})
                on conflict (id) do update set ssm_no_new = excluded.ssm_no_new, ssm_no_old = excluded.ssm_no_old,
                  reg_addr_line1 = excluded.reg_addr_line1, reg_addr_line2 = excluded.reg_addr_line2, reg_addr_line3 = excluded.reg_addr_line3,
                  reg_postcode = excluded.reg_postcode, reg_city = excluded.reg_city, reg_state = excluded.reg_state, reg_country = excluded.reg_country`.execute(tx);
      return {};
    }));
}

export async function updateCompanyContact(input: Input): Promise<ActionResult<{ version: number }>> {
  return runAction(ADMIN, updateCompanyContactSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ version: number }>`
        update app.company_profile set phone = ${d.phone}, email = ${d.email}, website = ${d.website}
         where id = 1 and version = ${d.version} returning version`.execute(tx);
      if (!r.rows[0]) return fail('Someone else changed the company profile. Reload and try again.');
      return { version: r.rows[0].version };
    }));
}

export async function saveCompanyStatutory(input: Input): Promise<ActionResult> {
  return runAction(SA, saveCompanyStatutorySchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update app.company_statutory set epf_employer_no = ${d.epfEmployerNo}, socso_employer_code = ${d.socsoEmployerCode},
                  lhdn_e_no = ${d.lhdnENo}, company_tax_no = ${d.companyTaxNo}, hrdf_registered = ${d.hrdfRegistered},
                  hrdf_levy_rate = ${d.hrdfLevyRatePct}::numeric, hrdf_mycoid = ${d.hrdfMycoid}
                 where id = 1`.execute(tx);
      if (affected(r) === 0) return fail('Save the company registration (SSM no. and registered address) first.');
      return {};
    }));
}

export async function savePayingAccount(input: Input): Promise<ActionResult<{ masked: string | null }>> {
  return runAction(SA, savePayingAccountSchema, input, async (d, { ctx }) => {
    let enc: Buffer | null = null;
    if (d.accountNo) {
      try {
        enc = fieldCrypto.encrypt(d.accountNo, { table: 'company_statutory', column: 'hlb_account_no', rowId: '1' });
      } catch {
        return fail('Encryption keys are not configured on the server, so the account number cannot be saved yet.');
      }
    }
    return withUserTx(ctx, async (tx) => {
      const r = enc
        ? await sql<{ l4: string | null }>`update app.company_statutory set hlb_account_name = ${d.accountName},
              hlb_account_no_enc = ${enc}, hlb_account_no_last4 = ${d.accountNo.slice(-4)} where id = 1 returning hlb_account_no_last4 as l4`.execute(tx)
        : await sql<{ l4: string | null }>`update app.company_statutory set hlb_account_name = ${d.accountName}
              where id = 1 returning hlb_account_no_last4 as l4`.execute(tx);
      if (!r.rows[0]) return fail('Save the company registration (SSM no. and registered address) first.');
      return { masked: r.rows[0].l4 ? `••••${r.rows[0].l4}` : null };
    });
  });
}

export async function revealPayingAccount(input: Input): Promise<ActionResult<{ accountNo: string }>> {
  const schema = z.object({ reason: z.preprocess((v) => (typeof v === 'string' && v.trim() ? v.trim() : null), z.string().max(500).nullable()) });
  return runAction(ADMIN, schema, input, async (d, { ctx }) =>
    withUserTx({ ...ctx, reason: d.reason }, async (tx) => {
      const r = (await sql<{ enc: Buffer | null }>`select hlb_account_no_enc as enc from app.company_statutory where id = 1`.execute(tx)).rows[0];
      if (!r?.enc) return fail('No account number has been saved.');
      await writeAccess(tx, { action: 'reveal', entityType: 'company_statutory', entityRef: 'HLB paying account', fields: ['hlb_account_no'], categories: ['bank'], reason: d.reason });
      try {
        return { accountNo: fieldCrypto.decrypt(r.enc, { table: 'company_statutory', column: 'hlb_account_no', rowId: '1' }) };
      } catch {
        throw new Error('PRET-CONFIG');
      }
    }));
}

export async function saveZakatRegistrations(input: Input): Promise<ActionResult> {
  return runAction(SA, saveZakatRegistrationsSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const keep = d.rows.map((r) => r.zakatBodyId);
      await sql`delete from app.company_zakat_registrations where not (zakat_body_id = any(${keep}::uuid[]))`.execute(tx);
      for (const row of d.rows) {
        await sql`insert into app.company_zakat_registrations as z (zakat_body_id, employer_ref) values (${row.zakatBodyId}::uuid, ${row.employerRef})
                  on conflict (zakat_body_id) do update set employer_ref = excluded.employer_ref
                  where z.employer_ref is distinct from excluded.employer_ref`.execute(tx);
      }
      return {};
    }));
}

export async function saveSignatories(input: Input): Promise<ActionResult> {
  return runAction(SA, saveSignatoriesSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      for (const s of d.rows) {
        if (s.signatureFileId) {
          const ok = (await sql<{ n: number }>`select count(*)::int as n from app.files where id = ${s.signatureFileId}::uuid
                        and subject = 'company_asset' and status = 'active'`.execute(tx)).rows[0]!.n;
          if (!ok) return fail('Upload the signature image again.', { signatureFileId: 'Upload the signature image again.' });
        }
        if (s.id) {
          const r = await sql`update app.company_signatories set name = ${s.name}, designation = ${s.designation},
                      signature_file_id = ${s.signatureFileId}::uuid, display_order = ${s.displayOrder}, is_active = ${s.isActive}
                     where id = ${s.id}::uuid`.execute(tx);
          if (affected(r) === 0) return NOT_FOUND;
        } else {
          await sql`insert into app.company_signatories (name, designation, signature_file_id, display_order, is_active)
                    values (${s.name}, ${s.designation}, ${s.signatureFileId}::uuid, ${s.displayOrder}, ${s.isActive})`.execute(tx);
        }
      }
      return {};
    }));
}

export async function saveGlMappings(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, saveGlMappingsSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      for (const r of d.rows) {
        if (r.glAccountCode == null) {
          await sql`delete from app.gl_mappings where purpose = ${r.purpose}`.execute(tx);
        } else {
          await sql`insert into app.gl_mappings as g (purpose, gl_account_code) values (${r.purpose}, ${r.glAccountCode})
                    on conflict (purpose) do update set gl_account_code = excluded.gl_account_code
                    where g.gl_account_code is distinct from excluded.gl_account_code`.execute(tx);
        }
      }
      return {};
    }));
}

export async function requestCompanyAssetUpload(input: Input): Promise<ActionResult<UploadIntent>> {
  return runAction(SA, requestCompanyAssetUploadSchema, input, async (d, { ctx, accessToken }) => {
    const r = await requestUpload(ctx, accessToken, {
      subject: 'company_asset', ownerEmployeeId: null, scope: d.kind === 'logo' ? 'logo' : 'signatures',
      originalName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes,
    });
    return { fileId: r.fileId, bucket: r.bucket, path: r.path, signedUrl: r.signedUrl, token: r.token };
  });
}

export async function confirmCompanyAssetUpload(input: Input): Promise<ActionResult<{ fileId: string }>> {
  return runAction(SA, fileIdSchema, input, async (d, { ctx, accessToken }) => {
    await confirmUpload(ctx, accessToken, d.fileId);
    return { fileId: d.fileId };
  });
}

export async function setCompanyLogo(input: Input): Promise<ActionResult> {
  return runAction(SA, fileIdSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const ok = (await sql<{ n: number }>`select count(*)::int as n from app.files where id = ${d.fileId}::uuid and subject = 'company_asset'
                   and status = 'active' and mime_type in ('image/png','image/jpeg')`.execute(tx)).rows[0]!.n;
      if (!ok) return fail('Upload the logo again.', { fileId: 'Upload the logo again.' });
      const r = await sql`update app.company_profile set logo_file_id = ${d.fileId}::uuid where id = 1`.execute(tx);
      if (affected(r) === 0) return fail('Save the company registration first.');
      return {};
    }));
}

// ===========================================================================
// Generic master helpers
// ===========================================================================
async function setActive(table: string, input: Input): Promise<ActionResult> {
  return runAction(ADMIN, setActiveSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql`update ${sql.table(`app.${table}`)} set is_active = ${d.isActive} where id = ${d.id}::uuid`.execute(tx);
      return affected(r) === 0 ? NOT_FOUND : {};
    }));
}

// ===========================================================================
// O2 Departments
// ===========================================================================
const HEAD_LATER = 'Head of department can be set once employee records are available (W2-003).';

export async function createDepartment(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, departmentInputSchema, input, async (d, { ctx }) => {
    if (d.headEmployeeId) return fail(HEAD_LATER, { headEmployeeId: HEAD_LATER });
    return withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`insert into app.departments (code, name, parent_id, cost_centre_id, is_active)
        values (${d.code}, ${d.name}, ${d.parentId}::uuid, ${d.costCentreId}::uuid, ${d.isActive}) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    });
  });
}

export async function updateDepartment(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updateDepartmentSchema, input, async (d, { ctx }) => {
    if (d.headEmployeeId) return fail(HEAD_LATER, { headEmployeeId: HEAD_LATER });
    return withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`update app.departments set code = ${d.code}, name = ${d.name}, parent_id = ${d.parentId}::uuid,
          cost_centre_id = ${d.costCentreId}::uuid, is_active = ${d.isActive} where id = ${d.id}::uuid returning id`.execute(tx);
      return r.rows[0] ? { id: r.rows[0].id } : NOT_FOUND;
    });
  });
}

export async function setDepartmentActive(input: Input): Promise<ActionResult> {
  return setActive('departments', input);
}

export async function exportDepartmentsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, departmentListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await departmentRows(tx, p, true);
      await exported(tx, 'departments', rows.length);
      return csvFile('departments', ['Code', 'Name', 'Parent', 'Head', 'Cost centre', 'Active headcount', 'Active'],
        rows.map((r) => [r.code, r.name, r.parentName, r.headName, r.costCentreName, r.activeHeadcount, r.isActive]));
    }));
}

// ===========================================================================
// O3 Positions
// ===========================================================================
export async function createPosition(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, positionInputSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`insert into app.positions (code, title, default_department_id, default_grade_id, description, is_active)
        values (${d.code}, ${d.title}, ${d.defaultDepartmentId}::uuid, ${d.defaultGradeId}::uuid, ${d.description}, ${d.isActive}) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function updatePosition(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updatePositionSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`update app.positions set code = ${d.code}, title = ${d.title},
          default_department_id = ${d.defaultDepartmentId}::uuid, default_grade_id = ${d.defaultGradeId}::uuid,
          description = ${d.description}, is_active = ${d.isActive} where id = ${d.id}::uuid returning id`.execute(tx);
      return r.rows[0] ? { id: r.rows[0].id } : NOT_FOUND;
    }));
}

export async function setPositionActive(input: Input): Promise<ActionResult> {
  return setActive('positions', input);
}

export async function exportPositionsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, positionListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await positionRows(tx, p, true);
      await exported(tx, 'positions', rows.length);
      return csvFile('positions', ['Code', 'Title', 'Default department', 'Default grade', 'Headcount', 'Active'],
        rows.map((r) => [r.code, r.title, r.defaultDepartmentName, r.defaultGradeName, r.headcount, r.isActive]));
    }));
}

// ===========================================================================
// O4 Grades
// ===========================================================================
export async function createGrade(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, gradeInputSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`insert into app.grades (code, name, rank, is_active)
        values (${d.code}, ${d.name}, ${d.rank}, ${d.isActive}) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function updateGrade(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updateGradeSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`update app.grades set code = ${d.code}, name = ${d.name}, rank = ${d.rank}, is_active = ${d.isActive}
         where id = ${d.id}::uuid returning id`.execute(tx);
      return r.rows[0] ? { id: r.rows[0].id } : NOT_FOUND;
    }));
}

export async function setGradeActive(input: Input): Promise<ActionResult> {
  return setActive('grades', input);
}

export async function exportGradesCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, gradeListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await gradeRows(tx, p, true);
      await exported(tx, 'grades', rows.length);
      return csvFile('grades', ['Code', 'Name', 'Rank', 'Headcount', 'Active'], rows.map((r) => [r.code, r.name, r.rank, r.headcount, r.isActive]));
    }));
}

// ===========================================================================
// O5 Work locations
// ===========================================================================
export async function createLocation(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, locationInputSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const a = d.address;
      const r = await sql<{ id: string }>`insert into app.work_locations (name, addr_line1, addr_line2, addr_line3, postcode, city, state, default_pattern_id, is_active)
        values (${d.name}, ${a.line1}, ${a.line2}, ${a.line3}, ${a.postcode}, ${a.city}, ${d.state}::app.my_state, ${d.defaultPatternId}::uuid, ${d.isActive})
        returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }), { 'address.line1': 'address.line1' });
}

export async function updateLocation(input: Input): Promise<ActionResult<UpdateLocationResult>> {
  return runAction(ADMIN, updateLocationSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const before = (await sql<{ state: string }>`select state::text from app.work_locations where id = ${d.id}::uuid for update`.execute(tx)).rows[0];
      if (!before) return NOT_FOUND;
      const a = d.address;
      await sql`update app.work_locations set name = ${d.name}, addr_line1 = ${a.line1}, addr_line2 = ${a.line2}, addr_line3 = ${a.line3},
                  postcode = ${a.postcode}, city = ${a.city}, state = ${d.state}::app.my_state, default_pattern_id = ${d.defaultPatternId}::uuid,
                  is_active = ${d.isActive} where id = ${d.id}::uuid`.execute(tx);
      // Leave recount for affected employees arrives with the employee and leave modules (W2-003+).
      return { id: d.id, stateChanged: before.state !== d.state, affectedEmployees: 0 };
    }));
}

export async function setLocationActive(input: Input): Promise<ActionResult> {
  return setActive('work_locations', input);
}

export async function exportLocationsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, locationListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await locationRows(tx, p, true);
      await exported(tx, 'work_locations', rows.length);
      return csvFile('work-locations', ['Name', 'City', 'State', 'Default working pattern', 'Active employees', 'Active'],
        rows.map((r) => [r.name, r.city, MY_STATE_LABELS[r.state], r.defaultPatternName, r.activeEmployees, r.isActive]));
    }));
}

// ===========================================================================
// O6 Working-week patterns
// ===========================================================================
type VersionData = z.output<typeof addPatternVersionSchema>['version'];
async function insertVersion(tx: Tx, patternId: string, v: VersionData): Promise<string> {
  const existing = (await sql<{ id: string }>`select id from app.working_pattern_versions
      where pattern_id = ${patternId}::uuid and effective_from = ${v.effectiveFrom}::date`.execute(tx)).rows[0];
  if (existing) {
    // Only a FUTURE version may be replaced (DB guard enforces).
    await sql`update app.working_pattern_versions set mon = ${v.mon}::app.day_type, tue = ${v.tue}::app.day_type, wed = ${v.wed}::app.day_type,
                thu = ${v.thu}::app.day_type, fri = ${v.fri}::app.day_type, sat = ${v.sat}::app.day_type, sun = ${v.sun}::app.day_type,
                hours_per_full_day = ${v.hoursPerFullDay}::numeric, month_day_basis = ${v.monthDayBasis}::app.month_day_basis
              where id = ${existing.id}::uuid`.execute(tx);
    return existing.id;
  }
  const r = await sql<{ id: string }>`insert into app.working_pattern_versions
      (pattern_id, effective_from, mon, tue, wed, thu, fri, sat, sun, hours_per_full_day, month_day_basis)
    values (${patternId}::uuid, ${v.effectiveFrom}::date, ${v.mon}::app.day_type, ${v.tue}::app.day_type, ${v.wed}::app.day_type,
            ${v.thu}::app.day_type, ${v.fri}::app.day_type, ${v.sat}::app.day_type, ${v.sun}::app.day_type,
            ${v.hoursPerFullDay}::numeric, ${v.monthDayBasis}::app.month_day_basis)
    returning id`.execute(tx);
  return r.rows[0]!.id;
}

export async function createWorkingPattern(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, createWorkingPatternSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`insert into app.working_patterns (name, is_active) values (${d.name}, ${d.isActive}) returning id`.execute(tx);
      const id = r.rows[0]!.id;
      await insertVersion(tx, id, d.version);
      return { id };
    }));
}

export async function updateWorkingPattern(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updateWorkingPatternSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`update app.working_patterns set name = ${d.name}, is_active = ${d.isActive}
         where id = ${d.id}::uuid returning id`.execute(tx);
      return r.rows[0] ? { id: r.rows[0].id } : NOT_FOUND;
    }));
}

export async function addPatternVersion(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, addPatternVersionSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const p = (await sql<{ id: string }>`select id from app.working_patterns where id = ${d.patternId}::uuid`.execute(tx)).rows[0];
      if (!p) return NOT_FOUND;
      return { id: await insertVersion(tx, d.patternId, d.version) };
    }));
}

export async function setWorkingPatternActive(input: Input): Promise<ActionResult> {
  return setActive('working_patterns', input);
}

export async function exportWorkingPatternsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, patternListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await patternRows(tx, p, true);
      await exported(tx, 'working_patterns', rows.length);
      return csvFile('working-patterns',
        ['Name', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Hours/day', 'Days-per-month basis', 'Effective from', 'Used by locations', 'Used by employees', 'Active'],
        rows.map((r) => [r.name, ...WEEKDAYS.map((w) => (r.current ? DAY_TYPE_SHORT[r.current.days[w]] : '')),
          r.current?.hoursPerFullDay ?? '', r.current ? MONTH_DAY_BASIS_LABELS[r.current.monthDayBasis] : '',
          csvDate(r.current?.effectiveFrom), r.usedByLocations, r.usedByEmployees, r.isActive]));
    }));
}

// ===========================================================================
// O7 Public holidays
// ===========================================================================
async function yearPublished(tx: Tx, year: number): Promise<boolean> {
  return (await sql<{ p: boolean }>`select app.holiday_year_published(${year}) as p`.execute(tx)).rows[0]?.p ?? false;
}
type HolidayFields = z.output<typeof updateHolidaySchema>;

async function insertHoliday(tx: Tx, year: number, h: Omit<HolidayFields, 'id' | 'isActive'>): Promise<string> {
  const r = await sql<{ id: string }>`insert into app.public_holidays (year, holiday_date, name, holiday_type, compulsory, is_observed, is_half_day, remarks)
    values (${year}, ${h.holidayDate}::date, ${h.name}, ${h.holidayType}::app.holiday_type, ${h.compulsory}::app.compulsory_holiday,
            ${h.isObserved}, ${h.isHalfDay}, ${h.remarks}) returning id`.execute(tx);
  const id = r.rows[0]!.id;
  await sql`insert into app.public_holiday_states (holiday_id, state)
            select ${id}::uuid, s::app.my_state from unnest(${[...new Set(h.states)]}::text[]) s`.execute(tx);
  return id;
}

export async function createHoliday(input: Input): Promise<ActionResult<HolidayChangeResult>> {
  return runAction(ADMIN, createHolidaySchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const id = await insertHoliday(tx, d.year, d);
      // BR-ORG-23 leave recount: delivered with the leave module (0 until then).
      return { id, yearPublished: await yearPublished(tx, d.year), affectedLeaveApplications: 0 };
    }));
}

export async function updateHoliday(input: Input): Promise<ActionResult<HolidayChangeResult>> {
  return runAction(ADMIN, updateHolidaySchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const cur = (await sql<{ year: number }>`select year from app.public_holidays where id = ${d.id}::uuid for update`.execute(tx)).rows[0];
      if (!cur) return NOT_FOUND;
      if (Number(d.holidayDate.slice(0, 4)) !== cur.year)
        return fail('The date must be within the same year.', { holidayDate: 'The date must be within the same year.' });
      await sql`update app.public_holidays set holiday_date = ${d.holidayDate}::date, name = ${d.name},
                  holiday_type = ${d.holidayType}::app.holiday_type, compulsory = ${d.compulsory}::app.compulsory_holiday,
                  is_observed = ${d.isObserved}, is_half_day = ${d.isHalfDay}, remarks = ${d.remarks}, is_active = ${d.isActive}
                where id = ${d.id}::uuid`.execute(tx);
      const states = [...new Set(d.states)];
      await sql`delete from app.public_holiday_states where holiday_id = ${d.id}::uuid and not (state::text = any(${states}::text[]))`.execute(tx);
      await sql`insert into app.public_holiday_states (holiday_id, state)
                select ${d.id}::uuid, s::app.my_state from unnest(${states}::text[]) s on conflict do nothing`.execute(tx);
      return { id: d.id, yearPublished: await yearPublished(tx, cur.year), affectedLeaveApplications: 0 };
    }), { holidayDate: 'holidayDate' });
}

export async function deleteHoliday(input: Input): Promise<ActionResult> {
  return runAction(ADMIN, idSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const h = (await sql<{ year: number }>`select year from app.public_holidays where id = ${d.id}::uuid`.execute(tx)).rows[0];
      if (!h) return NOT_FOUND;
      if (await yearPublished(tx, h.year)) return fail('This year is published — deactivate the holiday instead of deleting it.');
      const r = await sql`delete from app.public_holidays where id = ${d.id}::uuid`.execute(tx);
      return affected(r) === 0 ? NOT_FOUND : {};
    }));
}

export async function setHolidayActive(input: Input): Promise<ActionResult<HolidayChangeResult>> {
  return runAction(ADMIN, setActiveSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = (await sql<{ year: number }>`update app.public_holidays set is_active = ${d.isActive} where id = ${d.id}::uuid returning year`.execute(tx)).rows[0];
      if (!r) return NOT_FOUND;
      return { id: d.id, yearPublished: await yearPublished(tx, r.year), affectedLeaveApplications: 0 };
    }));
}

export async function copyHolidaysToNextYear(input: Input): Promise<ActionResult<CopyHolidaysResult>> {
  return runAction(ADMIN, copyHolidaysSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const preview = await copyPreview(tx, d.fromYear);
      if (preview.toYearStatus === 'published') return fail(`${preview.toYear} is already published — add holidays to it individually.`);
      const wanted = new Set(d.holidayIds);
      let created = 0;
      let skipped = 0;
      for (const it of preview.items.filter((i) => wanted.has(i.id))) {
        if (it.alreadyExists) { skipped++; continue; }
        const src = (await sql<{ holiday_type: 'national' | 'state' | 'company' | 'special'; compulsory: string | null; is_observed: boolean; is_half_day: boolean; remarks: string | null }>`
          select holiday_type::text, compulsory::text, is_observed, is_half_day, remarks from app.public_holidays where id = ${it.id}::uuid`.execute(tx)).rows[0]!;
        await insertHoliday(tx, preview.toYear, {
          holidayDate: it.targetDate, name: it.name, holidayType: src.holiday_type,
          states: it.states, compulsory: src.compulsory as HolidayFields['compulsory'], isObserved: src.is_observed,
          isHalfDay: src.is_half_day, remarks: src.remarks,
        });
        created++;
      }
      return {
        toYear: preview.toYear, created, skipped,
        toEnterFromGazette: preview.items.filter((i) => !wanted.has(i.id)).map((i) => ({ name: i.name, holidayDate: i.holidayDate })),
      };
    }));
}

export async function publishHolidayYear(input: Input): Promise<ActionResult<PublishHolidayYearResult>> {
  return runAction(ADMIN, publishHolidayYearSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const s = await holidayYearSummary(tx, d.year);
      if (s.status === 'published') return fail(`${d.year} is already published.`);
      const blocking = s.checks.filter((c) => c.blocking);
      if (blocking.length) {
        const detail = blocking.map((c) => `${MY_STATE_LABELS[c.state]}: missing ${c.compulsoryMissing.map((m) => COMPULSORY_HOLIDAY_LABELS[m]).join(', ')}`).join('; ');
        return fail(`Publishing is blocked — compulsory holidays missing (BR-ORG-20). ${detail}.`);
      }
      const warnings = s.checks.filter((c) => c.warning).map((c) => `${MY_STATE_LABELS[c.state]}: ${c.paidHolidayCount} paid holidays (fewer than 11).`);
      if (warnings.length && !d.acknowledgeWarnings) {
        return fail('Please acknowledge the warnings to publish.', { acknowledgeWarnings: warnings.join(' ') });
      }
      await sql`select app.publish_holiday_year(${d.year}, ${d.acknowledgeWarnings}) as w`.execute(tx);
      return { year: d.year, warnings };
    }));
}

export async function exportHolidaysCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, holidayListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await holidayRows(tx, p, true);
      await exported(tx, 'public_holidays', rows.length);
      return csvFile(`public-holidays-${p.year}`,
        ['Date', 'Day', 'Name', 'Type', 'States', 'EA compulsory', 'Observed', 'Half day', 'Working pattern', 'Remarks', 'Active'],
        rows.map((r) => [csvDate(r.holidayDate), r.dayOfWeek, r.name, HOLIDAY_TYPE_LABELS[r.holidayType],
          r.allStates ? 'All states' : r.states.map((s) => MY_STATE_LABELS[s]).join('; '),
          r.compulsory ? COMPULSORY_HOLIDAY_LABELS[r.compulsory] : '', r.isObserved, r.isHalfDay, r.patternName ?? '', r.remarks, r.isActive]));
    }));
}

// ===========================================================================
// O9 Cost centres
// ===========================================================================
export async function createCostCentre(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, costCentreInputSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`insert into app.cost_centres (code, name, autocount_code, is_active)
        values (${d.code}, ${d.name}, ${d.autocountCode}, ${d.isActive}) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function updateCostCentre(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updateCostCentreSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`update app.cost_centres set code = ${d.code}, name = ${d.name}, autocount_code = ${d.autocountCode},
          is_active = ${d.isActive} where id = ${d.id}::uuid returning id`.execute(tx);
      return r.rows[0] ? { id: r.rows[0].id } : NOT_FOUND;
    }));
}

export async function setCostCentreActive(input: Input): Promise<ActionResult> {
  return setActive('cost_centres', input);
}

export async function exportCostCentresCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, costCentreListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await costCentreRows(tx, p, true);
      await exported(tx, 'cost_centres', rows.length);
      return csvFile('cost-centres', ['Code', 'Name', 'AutoCount project/department code', 'Active'],
        rows.map((r) => [r.code, r.name, r.autocountCode, r.isActive]));
    }));
}

// ===========================================================================
// O10 Employee groups
// ===========================================================================
export async function createEmployeeGroup(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, employeeGroupInputSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`insert into app.employee_groups (name, description, is_active)
        values (${d.name}, ${d.description}, ${d.isActive}) returning id`.execute(tx);
      return { id: r.rows[0]!.id };
    }));
}

export async function updateEmployeeGroup(input: Input): Promise<ActionResult<{ id: string }>> {
  return runAction(ADMIN, updateEmployeeGroupSchema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const r = await sql<{ id: string }>`update app.employee_groups set name = ${d.name}, description = ${d.description}, is_active = ${d.isActive}
         where id = ${d.id}::uuid returning id`.execute(tx);
      return r.rows[0] ? { id: r.rows[0].id } : NOT_FOUND;
    }));
}

export async function setEmployeeGroupActive(input: Input): Promise<ActionResult> {
  return setActive('employee_groups', input);
}

export async function exportEmployeeGroupsCsv(params: Input): Promise<ActionResult<CsvFile>> {
  return runAction(ADMIN, groupListParamsSchema, params, async (p, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const { rows } = await groupRows(tx, p, true);
      await exported(tx, 'employee_groups', rows.length);
      return csvFile('employee-groups', ['Name', 'Description', 'Members', 'Used by', 'Active'],
        rows.map((r) => [r.name, r.description, r.memberCount, r.usedBy, r.isActive]));
    }));
}

// ===========================================================================
// O11 System settings (SA)
// ===========================================================================
const SETTING_COLUMNS: Record<string, string> = {
  employeeNoPrefix: 'employee_no_prefix', employeeNoPadding: 'employee_no_padding', employeeNoNext: 'employee_no_next',
  defaultProbationMonths: 'default_probation_months', maxProbationMonths: 'max_probation_months',
  noticeWeeksLt2: 'notice_weeks_lt2', noticeWeeks2to5: 'notice_weeks_2to5', noticeWeeksGe5: 'notice_weeks_ge5',
  inviteLeadDays: 'invite_lead_days', allowedEmailDomains: 'allowed_email_domains',
  idleTimeoutMinEmployee: 'idle_timeout_min_employee', idleTimeoutMinPrivileged: 'idle_timeout_min_privileged',
  lockoutThreshold: 'lockout_threshold', lockoutMinutes: 'lockout_minutes', mfaRequiredPrivileged: 'mfa_required_privileged',
  inviteLinkHours: 'invite_link_hours', reminderAfterWorkingDays: 'reminder_after_working_days',
  escalateAfterWorkingDays: 'escalate_after_working_days', saBatchApprovalRequired: 'sa_batch_approval_required',
  rehireKeepEmployeeNo: 'rehire_keep_employee_no', maxTopOfOrg: 'max_top_of_org',
  retentionYearsHr: 'retention_years_hr', retentionYearsPayroll: 'retention_years_payroll',
  retentionYearsAudit: 'retention_years_audit', retentionDaysImportFiles: 'retention_days_import_files',
  hrReplyToEmail: 'hr_reply_to_email', directoryShowBirthdays: 'directory_show_birthdays',
};

async function saveSettings(schema: z.ZodType<Record<string, unknown>>, input: Input): Promise<ActionResult<{ changed: string[] }>> {
  return runAction(SA, schema, input, async (d, { ctx }) =>
    withUserTx(ctx, async (tx) => {
      const before = (await sql<Record<string, unknown>>`select to_jsonb(s) as j from app.security_settings s where id = 1`.execute(tx)).rows[0]?.j as Record<string, unknown> | undefined;
      if (!before) return fail('Settings are missing — contact support.');
      const sets = [];
      const changed: string[] = [];
      for (const [key, value] of Object.entries(d)) {
        const col = SETTING_COLUMNS[key];
        if (!col) continue;
        if (JSON.stringify(before[col]) !== JSON.stringify(value)) changed.push(key);
        sets.push(key === 'allowedEmailDomains'
          ? sql`${sql.ref(col)} = ${value as string[]}::extensions.citext[]`
          : sql`${sql.ref(col)} = ${value as string | number | boolean | null}`);
      }
      if (changed.length === 0) return { changed };
      await sql`update app.security_settings set ${sql.join(sets, sql`, `)} where id = 1`.execute(tx);
      return { changed };
    }));
}

export async function saveEmployeeNumberSettings(input: Input) { return saveSettings(saveEmployeeNumberSettingsSchema, input); }
export async function saveProbationNoticeSettings(input: Input) { return saveSettings(saveProbationNoticeSettingsSchema, input); }
export async function saveSignInSecuritySettings(input: Input) { return saveSettings(saveSignInSecuritySettingsSchema, input); }
export async function saveApprovalSettings(input: Input) { return saveSettings(saveApprovalSettingsSchema, input); }
export async function saveEmploymentSettings(input: Input) { return saveSettings(saveEmploymentSettingsSchema, input); }
export async function saveRetentionSettings(input: Input) { return saveSettings(saveRetentionSettingsSchema, input); }
export async function saveNotificationSettings(input: Input) { return saveSettings(saveNotificationSettingsSchema, input); }
