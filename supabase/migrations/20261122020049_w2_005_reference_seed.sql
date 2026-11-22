-- PRET W2-005 · 05 — reference seed (policy data, not personal data): claim policy (F-CLM-03 defaults, Q21), the 20 Kakitangan
-- claim categories (PRD §7.5, Q19, Q24), mileage rate RM 0.600/km placeholder (Q19), Medical RM 300.00 per transaction (Block).
-- GL accounts are PLACEHOLDERS 'TBC-<code>' until Albert supplies the AutoCount chart of accounts (open question Q-W5-02);
-- tax treatments are the PRD proposals to verify with the tax adviser (Q24).

insert into app.claim_policy (id) values (1) on conflict (id) do nothing;

insert into app.claim_categories (code, name, claim_group, description, is_mileage, extra_fields, tax_treatment, gl_account_code, display_order)
values
  ('MEAL-PROS',  'Business Meals with Prospect Clients',                          'meals_entertainment', null, false, '{client_attendees}',   'reimbursement',      'TBC-MEAL-PROS',  10),
  ('MEAL-CUST',  'Business Meeting Meal with Customers',                          'meals_entertainment', null, false, '{client_attendees}',   'reimbursement',      'TBC-MEAL-CUST',  20),
  ('TRV-TICKET', 'Business Travel – Air, Train, Sea Tickets',                     'business_travel',     null, false, '{travel_destination}', 'reimbursement',      'TBC-TRV-TICKET', 30),
  ('TRV-HARD',   'Business Travel – Hardship Allowances',                         'business_travel',     'Proposed tax treatment: taxable allowance — to verify with the tax adviser (Q24).',
                                                                                                          false, '{travel_destination}', 'taxable_allowance',  'TBC-TRV-HARD',   40),
  ('TRV-HOTEL',  'Business Travel – Hotels, Accommodations',                      'business_travel',     null, false, '{travel_destination}', 'reimbursement',      'TBC-TRV-HOTEL',  50),
  ('TRV-MEAL',   'Business Travel – Meals',                                       'business_travel',     null, false, '{}',                   'reimbursement',      'TBC-TRV-MEAL',   60),
  ('TRV-TAXI',   'Business Travel – Taxi, eHailing, Local Transportation',        'business_travel',     null, false, '{}',                   'reimbursement',      'TBC-TRV-TAXI',   70),
  ('MKT-SALES',  'Customer Marketing / Sales Expenses',                           'marketing_sales',     null, false, '{}',                   'reimbursement',      'TBC-MKT-SALES',  80),
  ('EMP-COMM',   'Employee Communications',                                       'communications',      null, false, '{}',                   'exempt_benefit',     'TBC-EMP-COMM',   90),
  ('EMP-TRANS',  'Employee Transport',                                            'transport_mileage',   'Mileage: distance (km) × rate. Enter From, To and Purpose.',
                                                                                                          true,  '{from_to_purpose}',    'reimbursement',      'TBC-EMP-TRANS', 100),
  ('EMP-TRAVEL', 'Employee Travel',                                               'transport_mileage',   'Mileage: distance (km) × rate. Enter From, To and Purpose.',
                                                                                                          true,  '{from_to_purpose}',    'reimbursement',      'TBC-EMP-TRAVEL',110),
  ('EMP-WELL',   'Employee Wellbeing',                                            'employee_wellbeing',  'Proposed tax treatment: taxable perquisite — to verify with the tax adviser (Q24).',
                                                                                                          false, '{}',                   'taxable_perquisite', 'TBC-EMP-WELL',  120),
  ('EQUIP',      'Equipment Upright Purchase – PC, Notebook, Mobile Phone',       'equipment_software',  'Company asset.', false, '{}',     'reimbursement',      'TBC-EQUIP',     130),
  ('MEAL-STAFF', 'Meals for Employees',                                           'meals_entertainment', null, false, '{}',                   'exempt_benefit',     'TBC-MEAL-STAFF',140),
  ('MEDICAL',    'Medical Claim – Direct Staff',                                  'medical',             'Limit RM 300.00 per transaction (including SST). Employee only.',
                                                                                                          false, '{}',                   'exempt_benefit',     'TBC-MEDICAL',   150),
  ('OFFICE',     'Office Expenses',                                               'office_admin',        null, false, '{}',                   'reimbursement',      'TBC-OFFICE',    160),
  ('PARKING',    'Parking – Season Office',                                       'transport_mileage',   null, false, '{}',                   'exempt_benefit',     'TBC-PARKING',   170),
  ('POSTAL',     'Postal & Courier Expenses',                                     'office_admin',        null, false, '{}',                   'reimbursement',      'TBC-POSTAL',    180),
  ('SOFTWARE',   'Software Subscriptions',                                        'equipment_software',  null, false, '{}',                   'reimbursement',      'TBC-SOFTWARE',  190),
  ('TELECOM',    'Telecoms Internet, Mobile Expenses',                            'communications',      null, false, '{}',                   'exempt_benefit',     'TBC-TELECOM',   200)
on conflict (code) do nothing;

insert into app.claim_category_rates (category_id, effective_from, rate_per_km)
select c.id, date '2020-01-01', 0.600 from app.claim_categories c where c.code in ('EMP-TRANS','EMP-TRAVEL')
on conflict (category_id, effective_from) do nothing;

insert into app.claim_limits (category_id, applies_to, per_transaction, behaviour, effective_from)
select c.id, 'everyone', 300.00, 'block', date '2020-01-01' from app.claim_categories c
 where c.code = 'MEDICAL' and not exists (select 1 from app.claim_limits l where l.category_id = c.id);
