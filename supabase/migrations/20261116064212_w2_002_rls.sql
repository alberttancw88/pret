-- PRET W2-002 · 12 — RLS (enabled + forced), grants and policies for the W2-002 tables
-- Design: rls-policies.md §4 patterns, §5.1, §5.2, §5.7, §11. One policy per command; `to authenticated`;
-- WITH CHECK on every insert/update policy; helpers wrapped in (select …).
-- Deviations (recorded in docs/build/W2-002-backend-report.md):
--   * holiday_calendar_years, replacement_holidays, privacy_notices: writes only through the
--     registered definer functions (publish_holiday_year, regenerate_replacement_holidays,
--     publish_privacy_notice) — stricter than P-HR direct writes.
--   * company_zakat_registrations: DELETE P-SA (replace-set editing of CO12); gl_mappings: DELETE P-HR (clear a mapping).
--   * access_reviews (new table): P-SA.

do $$
declare t text;
begin
  foreach t in array array['zakat_bodies','company_zakat_registrations','company_signatories','gl_mappings','cost_centres',
                           'departments','grades','positions','employee_groups','working_patterns','working_pattern_versions',
                           'work_locations','holiday_calendar_years','public_holidays','public_holiday_states',
                           'replacement_holidays','privacy_notices','access_reviews']
  loop
    execute format('alter table app.%I enable row level security', t);
    execute format('alter table app.%I force row level security', t);
    execute format('revoke all on app.%I from public, anon, authenticated', t);
    execute format('grant all on app.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Table privileges (first gate)
-- ---------------------------------------------------------------------------
grant select, insert, update                 on app.zakat_bodies                to authenticated;
grant select, insert, update, delete         on app.company_zakat_registrations to authenticated;
grant select, insert, update                 on app.company_signatories         to authenticated;
grant select, insert, update, delete         on app.gl_mappings                 to authenticated;
grant select, insert, update                 on app.cost_centres                to authenticated;
grant select, insert, update                 on app.departments                 to authenticated;
grant select, insert, update                 on app.grades                      to authenticated;
grant select, insert, update                 on app.positions                   to authenticated;
grant select, insert, update                 on app.employee_groups             to authenticated;
grant select, insert, update                 on app.working_patterns            to authenticated;
grant select, insert, update                 on app.working_pattern_versions    to authenticated;
grant select, insert, update                 on app.work_locations              to authenticated;
grant select                                 on app.holiday_calendar_years      to authenticated;
grant select, insert, update, delete         on app.public_holidays             to authenticated;
grant select, insert, delete                 on app.public_holiday_states       to authenticated;
grant select                                 on app.replacement_holidays        to authenticated;
grant select                                 on app.privacy_notices             to authenticated;
grant select, insert, update                 on app.access_reviews              to authenticated;

-- ---------------------------------------------------------------------------
-- §5.1 Organisation, settings, reference
-- ---------------------------------------------------------------------------
-- Reference list: P-ACTIVE read, P-HR write
create policy zakat_bodies_select on app.zakat_bodies for select to authenticated using ((select app.is_active_user()));
create policy zakat_bodies_insert on app.zakat_bodies for insert to authenticated with check ((select app.is_admin()));
create policy zakat_bodies_update on app.zakat_bodies for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Company statutory family: P-HR read, P-SA write
create policy company_zakat_registrations_select on app.company_zakat_registrations for select to authenticated using ((select app.is_admin()));
create policy company_zakat_registrations_insert on app.company_zakat_registrations for insert to authenticated with check ((select app.is_sa()));
create policy company_zakat_registrations_update on app.company_zakat_registrations for update to authenticated
  using ((select app.is_sa())) with check ((select app.is_sa()));
create policy company_zakat_registrations_delete on app.company_zakat_registrations for delete to authenticated using ((select app.is_sa()));

create policy company_signatories_select on app.company_signatories for select to authenticated using ((select app.is_admin()));
create policy company_signatories_insert on app.company_signatories for insert to authenticated with check ((select app.is_sa()));
create policy company_signatories_update on app.company_signatories for update to authenticated
  using ((select app.is_sa())) with check ((select app.is_sa()));

create policy gl_mappings_select on app.gl_mappings for select to authenticated using ((select app.is_admin()));
create policy gl_mappings_insert on app.gl_mappings for insert to authenticated with check ((select app.is_admin()));
create policy gl_mappings_update on app.gl_mappings for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy gl_mappings_delete on app.gl_mappings for delete to authenticated using ((select app.is_admin()));

-- Organisation masters: P-ACTIVE read, P-HR write
do $$
declare t text;
begin
  foreach t in array array['cost_centres','departments','grades','positions','working_patterns','working_pattern_versions','work_locations']
  loop
    execute format('create policy %I on app.%I for select to authenticated using ((select app.is_active_user()))', t || '_select', t);
    execute format('create policy %I on app.%I for insert to authenticated with check ((select app.is_admin()))', t || '_insert', t);
    execute format('create policy %I on app.%I for update to authenticated using ((select app.is_admin())) with check ((select app.is_admin()))', t || '_update', t);
  end loop;
end $$;

-- Employee groups: P-HR (T3 membership tags)
create policy employee_groups_select on app.employee_groups for select to authenticated using ((select app.is_admin()));
create policy employee_groups_insert on app.employee_groups for insert to authenticated with check ((select app.is_admin()));
create policy employee_groups_update on app.employee_groups for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- Holiday calendars: P-ACTIVE where published (BR-ORG-25); P-HR all; delete only in draft years
create policy holiday_calendar_years_select on app.holiday_calendar_years for select to authenticated
  using ((select app.is_admin()) or ((select app.is_active_user()) and status = 'published'));

create policy public_holidays_select on app.public_holidays for select to authenticated
  using ((select app.is_admin()) or ((select app.is_active_user()) and app.holiday_year_published(year)));
create policy public_holidays_insert on app.public_holidays for insert to authenticated with check ((select app.is_admin()));
create policy public_holidays_update on app.public_holidays for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));
create policy public_holidays_delete on app.public_holidays for delete to authenticated
  using ((select app.is_admin()) and not app.holiday_year_published(year));

create policy public_holiday_states_select on app.public_holiday_states for select to authenticated
  using ((select app.is_admin()) or ((select app.is_active_user()) and app.holiday_visible(holiday_id)));
create policy public_holiday_states_insert on app.public_holiday_states for insert to authenticated with check ((select app.is_admin()));
create policy public_holiday_states_delete on app.public_holiday_states for delete to authenticated
  using ((select app.is_admin()) and not app.holiday_visible(holiday_id));

create policy replacement_holidays_select on app.replacement_holidays for select to authenticated
  using ((select app.is_admin()) or ((select app.is_active_user()) and app.holiday_visible(source_holiday_id)));

-- ---------------------------------------------------------------------------
-- §5.2 / §5.7 Privacy notice (P-ACTIVE read; publish via app.publish_privacy_notice) and access review (P-SA)
-- ---------------------------------------------------------------------------
create policy privacy_notices_select on app.privacy_notices for select to authenticated using ((select app.is_active_user()));

create policy access_reviews_select on app.access_reviews for select to authenticated using ((select app.is_sa()));
create policy access_reviews_insert on app.access_reviews for insert to authenticated
  with check ((select app.is_sa()) and reviewed_by = (select app.current_app_user_id()));
create policy access_reviews_update on app.access_reviews for update to authenticated
  using ((select app.is_sa())) with check ((select app.is_sa()) and reviewed_by = (select app.current_app_user_id()));
