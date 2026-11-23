import 'server-only';
import { sql, type Tx } from '../db';
import { fieldCrypto } from '../crypto';
import { formatMykad } from '../contracts/mykad';
import { balancesFor } from '../queries/leave';
import type { Json, JsonRow, MyDataDocument } from './my-data-export';

// W2-006 P20 — gathers the requester's OWN data inside their withUserTx (RLS applies: every query is also filtered on the
// caller's employee id). Must be called only after app.start_my_data_export() has written the access-log row in the same
// transaction: the employee's own MyKad / family MyKad / bank numbers are decrypted here and nowhere else (FR-G-11).

/** Internal columns never exported (ciphertext, blind indexes, technical keys). */
const STRIP = sql`array['nric_enc','nric_bidx','account_no_enc','account_no_bidx','asnb_account_no_enc','new_value_enc','new_value_bidx',
  'idempotency_key','version','created_by','updated_by','employee_id','photo_file_id','proof_file_id','file_id','attachment_file_id',
  'split_group_id','workflow_id','mc_checked_by','decided_by','cancelled_by','on_behalf_by','submitted_by','source_application_id',
  'source_credit_id','source_rollover_id','source_import_id','source_ledger_id','copied_from_claim_id','disbursement_batch_id','payroll_run_id',
  'duplicate_of','cost_centre_id','category_id','leave_type_id','bank_id','lhdn_branch_id','zakat_body_id','replaces_document_id',
  'reference_document_id','source_change_request_id','verified_by','withdrawn_by','decided_by_employee_id','cancelled_by_employee_id',
  'department_id','position_id','grade_id','manager_employee_id','work_location_id','working_pattern_id','leave_approver_employee_id',
  'claim_approver_employee_id','cover_employee_id','target_row_id','change_request_id','claim_id','is_deleted']::text[]`;

async function one(tx: Tx, q: ReturnType<typeof sql>): Promise<JsonRow | null> {
  const r = await sql<{ j: JsonRow | null }>`select (${q}) as j`.execute(tx);
  return r.rows[0]?.j ?? null;
}
async function many(tx: Tx, q: ReturnType<typeof sql>): Promise<JsonRow[]> {
  const r = await sql<{ j: JsonRow[] | null }>`select coalesce((${q}), '[]'::jsonb) as j`.execute(tx);
  return r.rows[0]?.j ?? [];
}
function tryDecrypt(enc: Buffer | null, ref: { table: string; column: string; rowId: string }, fmt: (s: string) => string = (s) => s): string | null {
  if (!enc) return null;
  try { return fmt(fieldCrypto.decrypt(enc, ref)); } catch { return null; }
}

export async function gatherMyData(tx: Tx, employeeId: string, company: string): Promise<MyDataDocument> {
  const me = sql`${employeeId}::uuid`;
  const employee = (await one(tx, sql`
    select (to_jsonb(e) - ${STRIP}) || jsonb_build_object(
             'department', d.name, 'position', p.title, 'grade', g.name, 'work_location', l.name, 'working_pattern', wp.name,
             'manager', (select m.full_name from app.employee_directory m where m.employee_id = e.manager_employee_id),
             'leave_approver', (select m.full_name from app.employee_directory m where m.employee_id = e.leave_approver_employee_id),
             'claim_approver', (select m.full_name from app.employee_directory m where m.employee_id = e.claim_approver_employee_id))
      from app.employees e
      join app.departments d on d.id = e.department_id join app.positions p on p.id = e.position_id
      join app.grades g on g.id = e.grade_id join app.work_locations l on l.id = e.work_location_id
      join app.working_patterns wp on wp.id = e.working_pattern_id
     where e.id = ${me}`)) ?? {};

  // ---- identifiers (own) — decrypted after the access log written by app.start_my_data_export
  const pEnc = (await sql<{ nric_enc: Buffer | null }>`select nric_enc from app.employee_personal where employee_id = ${me}`.execute(tx)).rows[0];
  const personalRow = await one(tx, sql`select to_jsonb(x) - ${STRIP} from app.employee_personal x where x.employee_id = ${me}`);
  const personal = personalRow
    ? { ...personalRow, nric: tryDecrypt(pEnc?.nric_enc ?? null, { table: 'employee_personal', column: 'nric_enc', rowId: employeeId }, formatMykad) }
    : null;

  const spouseEnc = (await sql<{ id: string; nric_enc: Buffer | null }>`select id, nric_enc from app.employee_spouses where employee_id = ${me}`.execute(tx)).rows;
  const spouses = (await many(tx, sql`select jsonb_agg((to_jsonb(x) - ${STRIP}) order by x.record_status, x.created_at) from app.employee_spouses x where x.employee_id = ${me}`))
    .map((r) => ({ ...r, nric: tryDecrypt(spouseEnc.find((s) => s.id === r.id)?.nric_enc ?? null, { table: 'employee_spouses', column: 'nric_enc', rowId: String(r.id) }, formatMykad) }));

  const childEnc = (await sql<{ id: string; nric_enc: Buffer | null }>`select id, nric_enc from app.employee_children where employee_id = ${me}`.execute(tx)).rows;
  const children = (await many(tx, sql`select jsonb_agg((to_jsonb(x) - ${STRIP}) order by x.date_of_birth) from app.employee_children x where x.employee_id = ${me}`))
    .map((r) => ({ ...r, nric: tryDecrypt(childEnc.find((s) => s.id === r.id)?.nric_enc ?? null, { table: 'employee_children', column: 'nric_enc', rowId: String(r.id) }) }));

  const bankEnc = (await sql<{ id: string; account_no_enc: Buffer | null; asnb_account_no_enc: Buffer | null }>`
    select id, account_no_enc, asnb_account_no_enc from app.employee_bank_accounts where employee_id = ${me}`.execute(tx)).rows;
  const bankAccounts = (await many(tx, sql`select jsonb_agg(((to_jsonb(x) - ${STRIP}) || jsonb_build_object('bank', k.name, 'bank_code', k.code)) order by x.effective_from desc, x.created_at desc)
      from app.employee_bank_accounts x left join app.banks k on k.id = x.bank_id where x.employee_id = ${me}`))
    .map((r) => {
      const enc = bankEnc.find((b) => b.id === r.id);
      return {
        ...r,
        account_no: tryDecrypt(enc?.account_no_enc ?? null, { table: 'employee_bank_accounts', column: 'account_no_enc', rowId: String(r.id) }),
        asnb_account_no: tryDecrypt(enc?.asnb_account_no_enc ?? null, { table: 'employee_bank_accounts', column: 'asnb_account_no_enc', rowId: String(r.id) }),
      };
    });

  // ---- other own records
  const sensitive = await one(tx, sql`select to_jsonb(x) - ${STRIP} from app.employee_sensitive x where x.employee_id = ${me}`);
  const maritalHistory = await many(tx, sql`select jsonb_agg((to_jsonb(x) - ${STRIP}) order by x.effective_date desc) from app.employee_marital_history x where x.employee_id = ${me}`);
  const emergencyContacts = await many(tx, sql`select jsonb_agg((to_jsonb(x) - ${STRIP}) order by x.priority) from app.employee_emergency_contacts x where x.employee_id = ${me}`);
  const statutory = await one(tx, sql`select (to_jsonb(x) - ${STRIP}) || jsonb_build_object('lhdn_branch', lb.name, 'zakat_body', zb.name)
      from app.employee_statutory_profiles x left join app.lhdn_branches lb on lb.id = x.lhdn_branch_id left join app.zakat_bodies zb on zb.id = x.zakat_body_id
     where x.employee_id = ${me}`);
  const jobHistory = await many(tx, sql`select jsonb_agg(((to_jsonb(h) - ${STRIP}) || jsonb_build_object('department', d.name, 'position', p.title, 'grade', g.name,
        'work_location', l.name, 'working_pattern', wp.name,
        'manager', (select m.full_name from app.employee_directory m where m.employee_id = h.manager_employee_id))) order by h.effective_date desc)
      from app.employee_job_history h
      join app.departments d on d.id = h.department_id join app.positions p on p.id = h.position_id
      join app.grades g on g.id = h.grade_id join app.work_locations l on l.id = h.work_location_id
      join app.working_patterns wp on wp.id = h.working_pattern_id
     where h.employee_id = ${me} and not h.is_deleted`);
  const separations = await many(tx, sql`select jsonb_agg((to_jsonb(x) - ${STRIP}) order by x.created_at desc) from app.employee_separations x where x.employee_id = ${me}`);
  const priorEmployments = await many(tx, sql`select jsonb_agg((to_jsonb(x) - ${STRIP}) order by x.date_from desc) from app.prior_employments x where x.employee_id = ${me}`);
  const documents = await many(tx, sql`select jsonb_agg(jsonb_build_object('title', x.title, 'category', x.category, 'document_date', x.document_date,
        'expiry_date', x.expiry_date, 'remarks', x.remarks, 'uploaded_at', x.created_at) order by x.created_at desc)
      from app.employee_documents x where x.employee_id = ${me} and x.is_active and x.visible_to_employee`);
  const changeRequests = await many(tx, sql`select jsonb_agg(((to_jsonb(c) - ${STRIP}) || jsonb_build_object('items',
        coalesce((select jsonb_agg(jsonb_build_object('group', i.group_label, 'field', i.field_label, 'operation', i.op,
                    'current_value', i.current_display,
                    'requested_value', case when i.new_value_enc is not null then
                         to_jsonb(case when i.new_value_last4 is not null then '••••' || i.new_value_last4 else '(protected value)' end)
                       else to_jsonb(i.new_value) end) order by i.group_label, i.field_label)
                  from app.change_request_items i where i.change_request_id = c.id), '[]'::jsonb))) order by c.created_at desc)
      from app.change_requests c where c.employee_id = ${me}`);

  const applications = await many(tx, sql`select jsonb_agg(((to_jsonb(a) - ${STRIP}) || jsonb_build_object('leave_type', t.name)) order by a.start_date desc)
      from app.leave_applications a join app.leave_types t on t.id = a.leave_type_id where a.employee_id = ${me}`);
  const ledger = await many(tx, sql`select jsonb_agg(((to_jsonb(x) - ${STRIP}) || jsonb_build_object('leave_type', t.name)) order by x.leave_year desc, x.effective_date, x.created_at)
      from app.leave_ledger x join app.leave_types t on t.id = x.leave_type_id where x.employee_id = ${me}`);
  const replacementCredits = await many(tx, sql`select jsonb_agg((to_jsonb(x) - ${STRIP}) order by x.date_worked desc) from app.replacement_credits x where x.employee_id = ${me}`);
  let balances: Json = null;
  try { balances = JSON.parse(JSON.stringify(await balancesFor(tx, employeeId, undefined, true))) as Json; } catch { balances = null; }

  const claims = await many(tx, sql`select jsonb_agg(((to_jsonb(c) - ${STRIP}) || jsonb_build_object('lines',
        coalesce((select jsonb_agg(((to_jsonb(l) - ${STRIP}) || jsonb_build_object('category', k.name)) order by l.line_no)
                    from app.claim_lines l join app.claim_categories k on k.id = l.category_id
                   where l.claim_id = c.id and l.is_live), '[]'::jsonb))) order by c.created_at desc)
      from app.claims c where c.employee_id = ${me}`);

  return {
    format: 'PRET my-data export', formatVersion: 1, generatedAt: new Date().toISOString(), company,
    employee, personal, sensitive, maritalHistory, emergencyContacts, spouses, children, statutory, bankAccounts, jobHistory,
    separations, priorEmployments, documents, changeRequests,
    leave: { applications, ledger, replacementCredits, balances },
    claims,
    payslips: 'Payslips, EA forms and payroll data are added when payroll goes live (R1.1).',
  };
}
