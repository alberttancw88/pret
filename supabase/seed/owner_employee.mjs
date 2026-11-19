// Generates the SQL that creates the FIRST Super Admin's own employee record with the reserved id already on
// their app_users row, then validates fk_app_users_employee. For the Delivery Lead to run ONCE per environment.
// The owner's details come from environment variables (never from the repo); the MyKad is encrypted with this
// environment's field key exactly as the app does (ADR-0003), so plaintext never reaches the database.
// The output contains personal data: pipe it straight into the SQL runner and do NOT save or commit it.
//
//   OWNER_MYKAD=… OWNER_FULL_NAME=… OWNER_GENDER=male|female OWNER_DOB=yyyy-mm-dd OWNER_PERSONAL_EMAIL=… \
//   OWNER_MOBILE=+60… OWNER_ADDR_LINE1=… OWNER_POSTCODE=… OWNER_CITY=… OWNER_STATE=SGR OWNER_JOIN_DATE=yyyy-mm-dd \
//   OWNER_DEPARTMENT_CODE=… OWNER_POSITION_CODE=… OWNER_GRADE_CODE=… [OWNER_LOCATION_NAME=…] [OWNER_PREFERRED_NAME=…] \
//   OWNER_EMPLOYEE_NO=… (e.g. the owner's Kakitangan INT-nnn) node --env-file=.env.local supabase/seed/owner_employee.mjs | <run in the SQL editor / psql>
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});
const fc = await import('../../src/server/crypto/field-crypto.ts');
const mk = await import('../../src/server/contracts/mykad.ts');

const OWNER_EMPLOYEE_ID = '9521b207-9f92-4dbf-a2f7-ba0fd2832dfc';   // already on the first Super Admin's app_users row
const env = (k, required = true) => {
  const v = process.env[k]?.trim();
  if (required && !v) { console.error(`missing ${k}`); process.exit(2); }
  return v || null;
};
const check = mk.checkMykad(env('OWNER_MYKAD'));
if (!check.ok) { console.error('OWNER_MYKAD is not a valid MyKad'); process.exit(2); }
const raw = env('PRET_FIELD_KEY_V1');
const v1 = fc.parseKey(raw, 'PRET_FIELD_KEY_V1');
const ring = { currentKeyId: 1, keys: new Map([[1, v1]]),
  blindIndexKey: process.env.PRET_BLIND_INDEX_KEY ? fc.parseKey(process.env.PRET_BLIND_INDEX_KEY, 'PRET_BLIND_INDEX_KEY') : fc.deriveBlindIndexKey(v1) };
const enc = fc.encryptField(ring, check.digits, { table: 'employee_personal', column: 'nric_enc', rowId: OWNER_EMPLOYEE_ID });
const bidx = fc.blindIndex(ring, 'nric', check.digits);
const q = (s) => (s === null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);
const hex = (b) => `'\\x${b.toString('hex')}'`;

process.stdout.write(`-- First Super Admin's employee record (generated — do not save; contains personal data)
begin;
-- the owner is Top of organisation; a dev seed's sample top (SMP-01) is moved under the owner (end of script)
insert into app.employees (id, employee_no, full_name, preferred_name, gender, work_email, mobile_phone, join_date, probation_months,
                           department_id, position_id, grade_id, manager_employee_id, work_location_id, work_state, working_pattern_id, status)
select '${OWNER_EMPLOYEE_ID}', ${q(env('OWNER_EMPLOYEE_NO'))}, ${q(env('OWNER_FULL_NAME'))}, ${q(env('OWNER_PREFERRED_NAME', false))},
       ${q(env('OWNER_GENDER'))}, u.login_email, ${q(env('OWNER_MOBILE'))}, ${q(env('OWNER_JOIN_DATE'))}::date, 0,
       (select id from app.departments where code = ${q(env('OWNER_DEPARTMENT_CODE'))}), (select id from app.positions where code = ${q(env('OWNER_POSITION_CODE'))}),
       (select id from app.grades where code = ${q(env('OWNER_GRADE_CODE'))}), null,
       (select id from app.work_locations where is_active and (${q(env('OWNER_LOCATION_NAME', false))} is null or name = ${q(env('OWNER_LOCATION_NAME', false))}) order by name limit 1),
       'SGR', (select default_pattern_id from app.work_locations where is_active and (${q(env('OWNER_LOCATION_NAME', false))} is null or name = ${q(env('OWNER_LOCATION_NAME', false))}) order by name limit 1),
       'confirmed'
  from app.app_users u where u.employee_id = '${OWNER_EMPLOYEE_ID}';
insert into app.employee_personal (employee_id, nric_enc, nric_last4, nric_bidx, date_of_birth, personal_email, res_addr_line1, res_postcode,
                                   res_city, res_state, continuous_service_date)
values ('${OWNER_EMPLOYEE_ID}', ${hex(enc)}, '${check.digits.slice(-4)}', ${hex(bidx)}, ${q(env('OWNER_DOB'))}::date, ${q(env('OWNER_PERSONAL_EMAIL'))},
        ${q(env('OWNER_ADDR_LINE1'))}, ${q(env('OWNER_POSTCODE'))}, ${q(env('OWNER_CITY'))}, ${q(env('OWNER_STATE'))}::app.my_state, ${q(env('OWNER_JOIN_DATE'))}::date);
insert into app.employee_sensitive (employee_id) values ('${OWNER_EMPLOYEE_ID}');
insert into app.employee_hr_private (employee_id, is_top_of_org) values ('${OWNER_EMPLOYEE_ID}', true);
insert into app.employee_statutory_profiles (employee_id, socso_no) values ('${OWNER_EMPLOYEE_ID}', '${check.digits}');
insert into app.employee_statutory_employer_flags (employee_id) values ('${OWNER_EMPLOYEE_ID}');
insert into app.employee_marital_history (employee_id, marital_status, effective_date) values ('${OWNER_EMPLOYEE_ID}', 'single', ${q(env('OWNER_JOIN_DATE'))}::date);
-- dev only: the seed's sample top of organisation now reports to the owner
update app.employee_hr_private set is_top_of_org = false where employee_id = '00000000-0000-4000-8000-0000000e0001';
update app.employee_job_history set manager_employee_id = '${OWNER_EMPLOYEE_ID}'
 where employee_id = '00000000-0000-4000-8000-0000000e0001' and change_type = 'new_hire';
alter table app.app_users validate constraint fk_app_users_employee;
commit;
-- Afterwards: the owner adds marital status, emergency contact, statutory and bank details through a change request /
-- another Admin (an Admin cannot edit their own sensitive fields — US-EMP-027).
`);
