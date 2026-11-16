-- PRET dev / staging seed — SYNTHETIC ONLY (PDPA; CLAUDE.md). Never run against production.
-- Company profile placeholder so the shell has a company name and address to show.

insert into app.company_profile (id, legal_name, phone, email, website,
                                 biz_addr_line1, biz_postcode, biz_city, biz_state)
values (1, 'Example Technology Sdn Bhd (DEV)', '+60300000000', 'hr@example.invalid', 'https://example.invalid',
        'Level 1, Example Tower', '50000', 'Kuala Lumpur', 'KUL')
on conflict (id) do nothing;
