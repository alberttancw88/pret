import 'server-only';
import { sql, type Tx } from '../db';

// Shared job-history helper (W2-003) for O8 reassign reportees and E15 bulk change manager.
// Not a Server Action module: functions taking a transaction must never be client-callable.

/** Inserts (or updates the same-date) job-history row copying the row in force, with a new manager. */
export async function addManagerChange(tx: Tx, employeeId: string, managerId: string, effectiveDate: string, remarks: string | null): Promise<void> {
  const cur = (await sql<{ id: string; effective_date: string; department_id: string; position_id: string; grade_id: string; work_location_id: string; working_pattern_id: string }>`
    select id, effective_date, department_id, position_id, grade_id, work_location_id, working_pattern_id from app.employee_job_history
     where employee_id = ${employeeId}::uuid and not is_deleted and effective_date <= ${effectiveDate}::date
     order by effective_date desc limit 1`.execute(tx)).rows[0];
  if (!cur) throw new Error('PRET-JOB-BEFORE-JOIN: the effective date cannot be before the join date');
  if (cur.effective_date === effectiveDate) {
    await sql`update app.employee_job_history set manager_employee_id = ${managerId}::uuid,
                change_type = case when effective_date <= app.today_myt() then 'data_correction'::app.job_change_type else 'manager_change'::app.job_change_type end,
                remarks = coalesce(${remarks}, remarks, 'Manager change') where id = ${cur.id}::uuid`.execute(tx);
    return;
  }
  await sql`insert into app.employee_job_history (employee_id, effective_date, change_type, department_id, position_id, grade_id,
              manager_employee_id, work_location_id, working_pattern_id, remarks)
            values (${employeeId}::uuid, ${effectiveDate}::date, 'manager_change', ${cur.department_id}::uuid, ${cur.position_id}::uuid,
              ${cur.grade_id}::uuid, ${managerId}::uuid, ${cur.work_location_id}::uuid, ${cur.working_pattern_id}::uuid, ${remarks})`.execute(tx);
}

