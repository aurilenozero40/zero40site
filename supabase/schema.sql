-- Dtudo · Controle de Estoque
-- Fonte de verdade do schema. Rodar manualmente no SQL editor do Supabase
-- (projeto novo, colar o arquivo inteiro e executar uma vez).
-- Idempotente: pode ser rodado de novo sem quebrar (create/alter ... if not exists).

-- ============================================================
-- EXTENSÕES
-- ============================================================
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================
-- EMPLOYEES — perfil 1:1 com auth.users
-- ============================================================
create table if not exists employees (
  id               uuid primary key references auth.users(id) on delete cascade,
  full_name        text not null,
  role             text not null default 'staff' check (role in ('admin', 'staff')),
  telegram_chat_id text unique,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ============================================================
-- SUPPLIERS — opcional, sem UI na Fase 1, só para não precisar
-- de alter table quando a Fase 2 (NF-e/fornecedores) chegar.
-- ============================================================
create table if not exists suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  cnpj       text unique,
  phone      text,
  email      text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- ITEMS
-- ============================================================
create table if not exists items (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  sku            text unique,
  barcode        text unique,
  category       text,
  subcategory    text,
  manufacturer   text,
  unit           text not null default 'un',
  cost_price     numeric(12,2),
  sale_price     numeric(12,2),
  quantity       numeric(12,3) not null default 0,
  min_stock      numeric(12,3) not null default 0,
  reorder_point  numeric(12,3),
  max_stock      numeric(12,3),
  abc_class      text check (abc_class in ('A', 'B', 'C')),
  location       text default 'principal',
  supplier_id    uuid references suppliers(id) on delete set null,
  active         boolean not null default true,
  created_by     uuid references employees(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_items_active on items(active);
create index if not exists idx_items_category on items(category);
create index if not exists idx_items_sku on items(sku);

alter table items alter column created_by set default auth.uid();

-- ============================================================
-- MOVEMENTS — ledger imutável (só insert, nunca update/delete)
-- ============================================================
create table if not exists movements (
  id                          uuid primary key default gen_random_uuid(),
  item_id                     uuid not null references items(id) on delete restrict,
  type                        text not null check (type in ('entrada', 'saida', 'ajuste')),
  subtype                     text check (subtype in (
                                 'compra', 'devolucao', 'transferencia',
                                 'uso', 'perda', 'venda', 'emprestimo'
                               )),
  quantity                    numeric(12,3) not null check (quantity > 0),
  unit_value                  numeric(12,2),
  total_value                 numeric(12,2) generated always as (quantity * coalesce(unit_value, 0)) stored,
  payment_method              text check (payment_method in ('a_vista', 'pix', 'cartao')),
  installments                int check (installments is null or installments >= 1),
  adjustment_increases_stock  boolean,
  reason                      text,
  source_channel              text not null default 'web' check (source_channel in ('web', 'telegram')),
  created_by                  uuid not null references employees(id) default auth.uid(),
  created_at                  timestamptz not null default now(),

  constraint ajuste_requires_reason check (
    type <> 'ajuste' or (reason is not null and length(trim(reason)) > 0)
  ),
  constraint ajuste_requires_direction check (
    type <> 'ajuste' or adjustment_increases_stock is not null
  ),
  constraint cartao_requires_installments check (
    payment_method <> 'cartao' or installments is not null
  )
);

create index if not exists idx_movements_item_id on movements(item_id);
create index if not exists idx_movements_created_at on movements(created_at);
create index if not exists idx_movements_type_created_at on movements(type, created_at);

-- View auxiliar para relatórios/agregações (mês a mês, por tipo/item)
create or replace view monthly_movement_summary as
select
  date_trunc('month', created_at) as month,
  type,
  item_id,
  sum(quantity)    as total_quantity,
  sum(total_value) as total_value,
  count(*)         as movement_count
from movements
group by 1, 2, 3;

-- ============================================================
-- TRIGGER: mantém items.quantity sincronizada a cada movimentação
-- ============================================================
create or replace function apply_movement_to_item_quantity()
returns trigger as $$
declare
  delta numeric(12,3);
begin
  if new.type = 'entrada' then
    delta := new.quantity;
  elsif new.type = 'saida' then
    delta := -new.quantity;
  else -- ajuste
    delta := case when new.adjustment_increases_stock then new.quantity else -new.quantity end;
  end if;

  update items set quantity = quantity + delta, updated_at = now() where id = new.item_id;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_apply_movement on movements;
create trigger trg_apply_movement
  after insert on movements
  for each row execute function apply_movement_to_item_quantity();

-- ============================================================
-- TRIGGER: cria a linha em employees automaticamente no signup
-- ============================================================
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into employees (id, full_name, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), 'staff')
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- RLS
-- ============================================================
alter table employees enable row level security;
alter table items enable row level security;
alter table movements enable row level security;
alter table suppliers enable row level security;

-- employees: qualquer funcionário autenticado lê o roster (exibir "quem fez" nas
-- movimentações); só admin escreve (tela de provisionamento).
drop policy if exists employees_select_all on employees;
create policy employees_select_all on employees
  for select using (auth.uid() is not null);

drop policy if exists employees_admin_write on employees;
create policy employees_admin_write on employees
  for all using (
    exists (select 1 from employees e where e.id = auth.uid() and e.role = 'admin')
  );

-- items: leitura livre para autenticados; insert/update livres (created_by nunca
-- confiado do client — default auth.uid() + with check); delete só admin.
drop policy if exists items_select_all on items;
create policy items_select_all on items
  for select using (auth.uid() is not null);

drop policy if exists items_insert_auth on items;
create policy items_insert_auth on items
  for insert with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists items_update_auth on items;
create policy items_update_auth on items
  for update using (auth.uid() is not null);

drop policy if exists items_delete_admin on items;
create policy items_delete_admin on items
  for delete using (
    exists (select 1 from employees e where e.id = auth.uid() and e.role = 'admin')
  );

-- movements: ledger imutável — só select/insert têm policy (update/delete ficam
-- default-deny, sem policy nenhuma).
drop policy if exists movements_select_all on movements;
create policy movements_select_all on movements
  for select using (auth.uid() is not null);

drop policy if exists movements_insert_auth on movements;
create policy movements_insert_auth on movements
  for insert with check (auth.uid() is not null and created_by = auth.uid());

-- suppliers: leitura livre, sem UI de escrita na Fase 1.
drop policy if exists suppliers_select_all on suppliers;
create policy suppliers_select_all on suppliers
  for select using (auth.uid() is not null);

-- ============================================================
-- REALTIME — necessário para o alerta de estoque baixo em tempo real.
-- Rodar uma vez (idempotente via exception handling, já que o Postgres
-- não tem "add to publication if not exists").
-- ============================================================
do $$
begin
  alter publication supabase_realtime add table items;
exception
  when duplicate_object then null;
end $$;

-- ============================================================
-- SEED — usuário admin é criado manualmente no Supabase Dashboard
-- (Auth > Users), depois promovido com:
--   update employees set role = 'admin' where id = '<uuid do usuário>';
-- ============================================================
