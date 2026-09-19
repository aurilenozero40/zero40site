-- Reproduz o "drift" que o banco de produção tem em relação ao supabase/schema.sql
-- (descoberto na auditoria) — as migrations precisam funcionar em cima disso.

-- employees em produção: username NOT NULL, sem default.
alter table employees add column username text;
update employees set username = 'legacy-' || substr(id::text, 1, 8) where username is null;
alter table employees alter column username set not null;

-- Tabela de taxas da operadora (existe só em produção). installments 0 = débito.
create table card_fee_rates (
  id uuid primary key default gen_random_uuid(),
  brand text not null,
  installments integer not null,
  fee_percent numeric not null,
  updated_at timestamptz not null default now()
);
insert into card_fee_rates (brand, installments, fee_percent) values
  ('master', 0, 1.00), ('master', 1, 3.30), ('master', 2, 3.88), ('master', 10, 8.89), ('master', 12, 9.88),
  ('visa',   0, 1.00), ('visa',   1, 3.30), ('visa',   2, 3.88), ('visa',   10, 8.89), ('visa',   12, 9.88),
  ('elo',    0, 1.89), ('elo',    1, 4.00), ('elo',   10, 11.39),
  ('hiper',  1, 0.00), ('hiper',  2, 1.89), ('hiper', 10, 7.10),
  ('amex',   1, 4.00), ('amex',   2, 6.18);
alter table card_fee_rates enable row level security;

-- Policies extras que existem em produção (papel "gerente").
create policy items_insert_gerente_admin on items for insert with check (true);
create policy items_update_gerente_admin on items for update
  using (exists (select 1 from employees e where e.id = auth.uid() and e.role = any (array['admin','gerente'])));
