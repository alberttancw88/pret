-- PRET W2-003 · 05 — follow-ups found while wiring the server layer.
-- ADM/SA schedule (or clear) an employee user's invitation email (FR-EMP-02): column grant only; the
-- app_users RLS policies (ADM: employee users without privileged roles, not self) and guards still apply.
grant update (invite_scheduled_for) on app.app_users to authenticated;
-- ix_app_users_employee duplicated the index behind the existing unique constraint on app_users.employee_id.
drop index if exists app.ix_app_users_employee;
