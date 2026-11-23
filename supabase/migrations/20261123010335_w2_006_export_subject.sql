-- PRET W2-006 · 02 — export_files may register an employee's own "Download my data" file (subject_type 'employee',
-- subject_id = the employee). Found by supabase/tests/w2_006_role_matrix.sql (D11).
alter table app.export_files drop constraint if exists export_files_subject_type_check;
alter table app.export_files add constraint export_files_subject_type_check
  check (subject_type = any (array['disbursement_batch','claims_filter','claims_range','report','employee']::text[]));
