-- PRET dev / staging seed — SYNTHETIC ONLY (PDPA; CLAUDE.md). Never run against production.
-- Company profile placeholder so the shell has a company name and address to show.

insert into app.company_profile (id, legal_name, phone, email, website,
                                 biz_addr_line1, biz_postcode, biz_city, biz_state)
values (1, 'Example Technology Sdn Bhd (DEV)', '+60300000000', 'hr@example.invalid', 'https://example.invalid',
        'Level 1, Example Tower', '50000', 'Kuala Lumpur', 'KUL')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- W2-002 (synthetic): statutory placeholder, a work location and a SAMPLE holiday calendar.
-- The holidays below are NOT the Malaysian gazette — names are tagged [SAMPLE] and dates are
-- illustrative only. Real calendars are entered / imported by HR (BR-ORG-26) and published.
-- ---------------------------------------------------------------------------
insert into app.company_statutory (id, ssm_no_new, reg_addr_line1, reg_postcode, reg_city, reg_state)
values (1, '000000000000', 'Level 1, Example Tower', '50000', 'Kuala Lumpur', 'KUL')
on conflict (id) do nothing;

insert into app.work_locations (name, addr_line1, postcode, city, state, default_pattern_id)
values ('HQ – Selangor (DEV)', '1 Jalan Contoh', '40000', 'Shah Alam', 'SGR', '00000000-0000-4000-8000-00000000a001')
on conflict (name) do nothing;

do $$
declare v_id uuid; r record;
begin
  if exists (select 1 from app.public_holidays where year = 2027 and name like '[SAMPLE]%') then
    return;
  end if;
  for r in select * from (values
      (date '2027-01-01', '[SAMPLE] New Year',                 'national'::app.holiday_type, null::app.compulsory_holiday),
      (date '2027-03-14', '[SAMPLE] Festival A (Sunday)',     'national', null),
      (date '2027-05-01', '[SAMPLE] Workers'' Day',           'national', 'workers_day'),
      (date '2027-06-07', '[SAMPLE] Agong''s Birthday',       'national', 'agong_birthday'),
      (date '2027-08-31', '[SAMPLE] National Day',            'national', 'national_day'),
      (date '2027-09-16', '[SAMPLE] Malaysia Day',            'national', 'malaysia_day'),
      (date '2027-12-11', '[SAMPLE] Ruler''s Birthday',       'state',    'ruler_birthday_or_ft_day'),
      (date '2027-12-25', '[SAMPLE] Festival B',              'national', null)
    ) as t(d, n, ty, c)
  loop
    insert into app.public_holidays (year, holiday_date, name, holiday_type, compulsory)
    values (2027, r.d, r.n, r.ty, r.c) returning id into v_id;
    insert into app.public_holiday_states (holiday_id, state)
    select v_id, s from unnest(case when r.ty = 'state' then array['SGR']::app.my_state[]
                                    else enum_range(null::app.my_state) end) s;
  end loop;
end $$;
