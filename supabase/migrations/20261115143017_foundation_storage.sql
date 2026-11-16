-- PRET W2-001 Foundation · 06 — Storage buckets and policies (ADR-0007, rls-policies.md §9)
-- All buckets private. Authorisation lives in the app.files registry; Storage policies only
-- ask the registry (qualified objects.name — Direct Order 0026 lesson). No UPDATE / DELETE
-- policies for users (upsert disabled); retention deletion runs as pret_jobs (service role).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('employee-files', 'employee-files', false, 10485760,
     array['image/jpeg','image/png','image/heic','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('leave-files',    'leave-files',    false, 10485760, array['image/jpeg','image/png','image/heic','application/pdf']),
  ('claim-files',    'claim-files',    false, 10485760, array['image/jpeg','image/png','image/heic','application/pdf']),
  ('cr-files',       'cr-files',       false, 10485760, array['image/jpeg','image/png','image/heic','application/pdf']),
  ('generated',      'generated',      false, 10485760,
     array['application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/zip']),
  ('imports',        'imports',        false, 10485760,
     array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv']),
  ('company',        'company',        false, 10485760, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy pret_objects_select on storage.objects for select to authenticated
  using (bucket_id in ('employee-files','leave-files','claim-files','cr-files','generated','imports','company')
         and app.storage_read_allowed(objects.bucket_id, objects.name));

create policy pret_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('employee-files','leave-files','claim-files','cr-files','imports','company')
              and app.storage_upload_allowed(objects.bucket_id, objects.name));
