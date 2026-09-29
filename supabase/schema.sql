-- ============================================================================
-- DTUDO · CONTROLE DE ESTOQUE E VENDAS  —  schema.sql (FONTE ÚNICA DO BANCO)
-- ============================================================================
--
-- COMO USAR
--   Cole este arquivo INTEIRO no SQL Editor do Supabase e execute (Run).
--   É idempotente: pode rodar de novo quantas vezes quiser — em banco novo cria
--   tudo; em banco existente só acrescenta/atualiza, sem apagar dados.
--   Toda mudança futura de banco entra AQUI, na seção certa (não crie outros arquivos).
--
-- ÍNDICE
--    0. Extensões
--    1. Tabelas base ............ employees, suppliers, items, movements, card_fee_rates
--    2. Compatibilidade ......... atualiza bancos criados por versões antigas deste arquivo
--    3. Papéis e permissões ..... ceo / admin / gerente / vendedor
--    4. Configurações ........... app_settings
--    5. Clientes e vendas ....... customers, sales, sale_items, sale_payments
--    6. Auditoria ............... audit_logs (imutável)
--    7. Notificações ............ notification_outbox (Telegram é só um canal)
--    8. Triggers ................ novo usuário, estoque, imutabilidade, auditoria
--    9. Segurança ............... RLS + privilégios
--   10. Regras de negócio ....... create_sale, cancel_sale, return_sale_items
--   11. Relatórios .............. dashboard, alertas de estoque, resumo mensal
--   12. Permissão de execução
--   13. Realtime
--
-- REGRAS QUE O BANCO GARANTE (nenhuma depende do frontend)
--   • Estoque (items.quantity) SÓ muda por movimentação — nunca por UPDATE direto.
--   • Estoque nunca fica negativo; venda trava as linhas dos produtos (sem vender a
--     mesma unidade duas vezes) e é idempotente (retry não duplica venda nem aviso).
--   • Movimentações, auditoria e pagamentos são imutáveis; venda nunca é apagada.
--   • Preço, desconto, juros e taxa de cartão são calculados AQUI, não no navegador.
--   • O evento de notificação nasce na MESMA transação da venda (outbox); se o
--     Telegram cair, a venda continua válida e o envio é repetido depois.
--
-- PERMISSÕES
--                                   vendedor    gerente    admin / ceo
--   registrar venda                    sim        sim          sim
--   ver vendas                       só as suas   todas        todas
--   dar desconto                     limite*      limite*      limite*    (*app_settings)
--   cancelar venda / devolução         não        sim          sim
--   cadastrar/editar produto e preço   não        sim          sim
--   excluir produto                    não        não          sim
--   entrada / ajuste / perda manual    não        sim          sim
--   funcionários e configurações       não        não          sim
--
-- ERROS DE NEGÓCIO
--   As funções de venda levantam erro com mensagem em português e um código de
--   máquina em `hint` (ex.: INSUFFICIENT_STOCK, DISCOUNT_NOT_ALLOWED, FORBIDDEN).
-- ============================================================================


-- ============================================================================
-- 0. EXTENSÕES
-- ============================================================================
create extension if not exists "pgcrypto";


-- ============================================================================
-- 1. TABELAS BASE
-- ============================================================================

-- ---- 1.1 employees: perfil 1:1 com auth.users --------------------------------
create table if not exists public.employees (
  id               uuid primary key references auth.users(id) on delete cascade,
  username         text not null,
  full_name        text not null,
  role             text not null default 'vendedor',   -- check em 2.2
  telegram_chat_id text unique,                        -- legado: o Telegram agora só notifica
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- ---- 1.2 suppliers ----------------------------------------------------------
create table if not exists public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  cnpj       text unique,
  phone      text,
  email      text,
  created_at timestamptz not null default now()
);

do $$
begin
  create unique index if not exists suppliers_name_key on public.suppliers (lower(name));
exception when others then
  raise notice 'Não foi possível criar índice único em suppliers (nomes duplicados existentes?): %', sqlerrm;
end $$;

-- Fornecedores/origens de compra do lojista — pode crescer pela tela, isso aqui é só o ponto de partida.
insert into public.suppliers (name)
select v.name from (values ('EUA'), ('EUROPA'), ('PRG'), ('SP')) as v(name)
where not exists (select 1 from public.suppliers s where lower(s.name) = lower(v.name));

-- ---- 1.3 items (produtos) ---------------------------------------------------
create table if not exists public.items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  sku           text unique,
  barcode       text unique,
  category      text,
  subcategory   text,
  manufacturer  text,
  description   text,
  unit          text not null default 'un',
  cost_price    numeric(12,2),
  sale_price    numeric(12,2),
  quantity      numeric(12,3) not null default 0,      -- só muda por movimentação
  min_stock     numeric(12,3) not null default 0,
  reorder_point numeric(12,3),
  max_stock     numeric(12,3),
  abc_class     text check (abc_class in ('A', 'B', 'C')),
  location      text default 'principal',
  supplier_id   uuid references public.suppliers(id) on delete set null,
  track_serial  boolean not null default false,       -- true: cada unidade tem número de série/IMEI próprio
  condition     text not null default 'novo' check (condition in ('novo', 'seminovo')),
  active        boolean not null default true,
  created_by    uuid references public.employees(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_items_active   on public.items (active);
create index if not exists idx_items_category on public.items (category);
create index if not exists idx_items_sku      on public.items (sku);
create index if not exists idx_items_name     on public.items (lower(name));

-- ---- 1.4 movements: ledger de estoque (só insert; nunca update/delete) -----------
--   type    : entrada | saida | ajuste
--   subtype : compra | devolucao | transferencia | cancelamento (entrada)
--             uso | perda | venda | emprestimo (saída) | outros        — check em 2.3
create table if not exists public.movements (
  id                         uuid primary key default gen_random_uuid(),
  item_id                    uuid not null references public.items(id) on delete restrict,
  type                       text not null check (type in ('entrada', 'saida', 'ajuste')),
  subtype                    text,
  quantity                   numeric(12,3) not null check (quantity > 0),
  unit_value                 numeric(12,2),
  total_value                numeric(12,2) generated always as (quantity * coalesce(unit_value, 0)) stored,
  payment_method             text check (payment_method in ('a_vista', 'pix', 'cartao')),   -- legado (vendas novas usam sale_payments)
  installments               int check (installments is null or installments >= 1),
  card_brand                 text,
  discount_value             numeric(12,2),
  fee_percent                numeric(6,3),
  fee_value                  numeric(12,2) not null default 0,
  net_value                  numeric(12,2) generated always as ((quantity * coalesce(unit_value, 0)) - coalesce(fee_value, 0)) stored,
  adjustment_increases_stock boolean,
  reason                     text,
  source_channel             text not null default 'web' check (source_channel in ('web', 'telegram')),
  sale_id                    uuid,                     -- FK em 5.5 (venda que originou o movimento)
  created_by                 uuid not null references public.employees(id) default auth.uid(),
  created_at                 timestamptz not null default now(),

  constraint ajuste_requires_reason check (type <> 'ajuste' or (reason is not null and length(trim(reason)) > 0)),
  constraint ajuste_requires_direction check (type <> 'ajuste' or adjustment_increases_stock is not null),
  constraint cartao_requires_installments check (payment_method <> 'cartao' or installments is not null),
  constraint cartao_requires_card_brand check (payment_method <> 'cartao' or card_brand is not null)
);

create index if not exists idx_movements_item_id         on public.movements (item_id);
create index if not exists idx_movements_created_at      on public.movements (created_at);
create index if not exists idx_movements_type_created_at on public.movements (type, created_at);
create index if not exists idx_movements_sale_id         on public.movements (sale_id) where sale_id is not null;

-- ---- 1.5 card_fee_rates: taxa que a OPERADORA cobra da loja ---------------------
--   installments: 0 = débito · 1 = crédito à vista · N = crédito em N vezes
create table if not exists public.card_fee_rates (
  id           uuid primary key default gen_random_uuid(),
  brand        text not null,
  installments integer not null,
  fee_percent  numeric not null,
  updated_at   timestamptz not null default now()
);


-- ============================================================================
-- 2. COMPATIBILIDADE COM BANCOS CRIADOS POR VERSÕES ANTIGAS DESTE ARQUIVO
--    (em banco novo, tudo abaixo é no-op ou só cria os checks finais)
-- ============================================================================

-- ---- 2.1 colunas que versões antigas não tinham ------------------------------------
alter table public.employees add column if not exists username text;
alter table public.items     add column if not exists description text;
alter table public.items     add column if not exists track_serial boolean not null default false;
alter table public.items     add column if not exists condition text not null default 'novo';
do $$
begin
  alter table public.items add constraint items_condition_check check (condition in ('novo', 'seminovo'));
exception when duplicate_object then null;
end $$;
alter table public.items     alter column created_by set default auth.uid();
alter table public.movements add column if not exists sale_id uuid;
alter table public.movements add column if not exists card_brand text;
alter table public.movements add column if not exists discount_value numeric(12,2);
alter table public.movements add column if not exists fee_percent numeric(6,3);
alter table public.movements add column if not exists fee_value numeric(12,2) not null default 0;
alter table public.movements add column if not exists net_value numeric(12,2)
  generated always as ((quantity * coalesce(unit_value, 0)) - coalesce(fee_value, 0)) stored;

do $$
begin
  alter table public.movements
    add constraint cartao_requires_card_brand check (payment_method <> 'cartao' or card_brand is not null);
exception when duplicate_object then null;
end $$;

do $$
begin
  create unique index if not exists card_fee_rates_brand_installments_key
    on public.card_fee_rates (brand, installments);
exception when others then
  raise notice 'Não foi possível criar índice único em card_fee_rates: %', sqlerrm;
end $$;

-- ---- 2.2 papéis: ceo | admin | gerente | vendedor --------------------------------
-- O nome do check antigo varia entre ambientes: remove qualquer um sobre `role`.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.employees'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.employees drop constraint %I', c.conname);
  end loop;
end $$;

-- 'staff' / 'operador' (legado) passam a ser 'vendedor'.
update public.employees set role = 'vendedor'
where role not in ('ceo', 'admin', 'gerente', 'vendedor');

alter table public.employees alter column role set default 'vendedor';
alter table public.employees
  add constraint employees_role_check check (role in ('ceo', 'admin', 'gerente', 'vendedor'));

-- ---- 2.3 subtipos do ledger ---------------------------------------------------------
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.movements'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%subtype%'
  loop
    execute format('alter table public.movements drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.movements
  add constraint movements_subtype_check
  check (subtype is null or subtype in
    ('compra','devolucao','transferencia','uso','perda','venda','emprestimo','cancelamento','troca','outros'));

-- Coerência tipo × subtipo (NOT VALID: não reprova histórico, barra tudo que for novo).
-- 'troca' (entrada) só nasce dentro de create_sale — produto recebido do cliente como entrada.
alter table public.movements
  add constraint movements_subtype_type_check
  check (
    subtype is null
    or subtype = 'outros'
    or (type = 'entrada' and subtype in ('compra','devolucao','transferencia','cancelamento','troca'))
    or (type = 'saida'   and subtype in ('uso','perda','venda','emprestimo'))
    or (type = 'ajuste')
  ) not valid;

-- ---- 2.4 estoque nunca negativo ----------------------------------------------------------
-- NOT VALID: não quebra se já existir item negativo hoje, mas barra toda alteração nova.
do $$
begin
  alter table public.items
    add constraint items_quantity_not_negative check (quantity >= 0) not valid;
exception when duplicate_object then null;
end $$;


-- ============================================================================
-- 3. PAPÉIS E PERMISSÕES
-- ============================================================================
create or replace function public.current_role_name()
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.employees where id = auth.uid() and active
$$;

create or replace function public.role_rank(p_role text)
returns integer
language sql immutable
as $$
  select case p_role when 'ceo' then 4 when 'admin' then 4 when 'gerente' then 3 when 'vendedor' then 1 else 0 end
$$;

-- gerente, admin e ceo
create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.role_rank(public.current_role_name()) >= 3, false)
$$;

-- admin e ceo
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role_name() in ('admin', 'ceo'), false)
$$;

create or replace function public.is_active_employee()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.employees where id = auth.uid() and active)
$$;


-- ============================================================================
-- 4. CONFIGURAÇÕES
-- ============================================================================
create table if not exists public.app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.employees(id),
  updated_at  timestamptz not null default now()
);

insert into public.app_settings (key, value, description) values
  ('discount_limit_percent_vendedor', '0',   'Desconto máximo (%) que um vendedor pode dar numa venda'),
  ('discount_limit_percent_gerente',  '100', 'Desconto máximo (%) que um gerente pode dar numa venda'),
  ('max_interest_percent',            '50',  'Juros máximo (%) que pode ser cobrado do cliente no parcelado'),
  ('notify_events',
   '["SALE_COMPLETED","SALE_CANCELLED","SALE_RETURNED","LOW_STOCK","OUT_OF_STOCK"]',
   'Eventos enviados ao Telegram do CEO')
on conflict (key) do nothing;

create or replace function public.setting_json(p_key text, p_default jsonb)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select coalesce((select value from public.app_settings where key = p_key), p_default)
$$;

create or replace function public.setting_numeric(p_key text, p_default numeric)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce((select (value #>> '{}')::numeric from public.app_settings where key = p_key), p_default)
$$;


-- ============================================================================
-- 5. CLIENTES E VENDAS
-- ============================================================================

-- ---- 5.1 customers ------------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  document   text check (document is null or document ~ '^[0-9]{11}$' or document ~ '^[0-9]{14}$'),   -- CPF/CNPJ só dígitos
  phone      text,
  whatsapp   text,
  email      text,
  address    text,
  notes      text,
  active     boolean not null default true,
  created_by uuid references public.employees(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customers_document_key on public.customers (document) where document is not null;
create index if not exists idx_customers_name    on public.customers (lower(name));
create index if not exists idx_customers_created on public.customers (created_at desc);

-- ---- 5.2 sales ----------------------------------------------------------------------
create sequence if not exists public.sale_number_seq;

create or replace function public.sale_code(p_number bigint)
returns text
language sql immutable
as $$ select 'VND-' || lpad(p_number::text, 6, '0') $$;

create table if not exists public.sales (
  id              uuid primary key default gen_random_uuid(),
  number          bigint not null unique default nextval('public.sale_number_seq'),
  idempotency_key uuid not null unique,
  status          text not null default 'concluida'
                  check (status in ('pendente','concluida','cancelada','devolvida','parcialmente_devolvida')),
  seller_id       uuid not null references public.employees(id),
  customer_id     uuid references public.customers(id),
  subtotal        numeric(12,2) not null check (subtotal >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  interest_amount numeric(12,2) not null default 0 check (interest_amount >= 0),
  total           numeric(12,2) not null check (total >= 0),
  refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0),
  trade_in_amount numeric(12,2) not null default 0 check (trade_in_amount >= 0),
  trade_in_item_id uuid references public.items(id),
  notes           text,
  cancelled_at    timestamptz,
  cancelled_by    uuid references public.employees(id),
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sales_total_consistent check (total = subtotal - discount_amount + interest_amount - trade_in_amount),
  constraint sales_cancel_consistent check (status <> 'cancelada' or (cancelled_at is not null and cancel_reason is not null))
);

create index if not exists idx_sales_created  on public.sales (created_at desc);
create index if not exists idx_sales_seller   on public.sales (seller_id, created_at desc);
create index if not exists idx_sales_customer on public.sales (customer_id, created_at desc);
create index if not exists idx_sales_status   on public.sales (status, created_at desc);

-- ---- 5.1b compatibilidade: colunas de entrada (troca) que bancos antigos não têm --------------
alter table public.sales add column if not exists trade_in_amount numeric(12,2) not null default 0;
alter table public.sales add column if not exists trade_in_item_id uuid references public.items(id);

-- total passa a descontar também o valor de entrada (troca) — recria a constraint com a fórmula nova.
do $$
begin
  alter table public.sales drop constraint if exists sales_total_consistent;
  alter table public.sales
    add constraint sales_total_consistent check (total = subtotal - discount_amount + interest_amount - trade_in_amount);
exception when others then
  raise notice 'Não foi possível recriar sales_total_consistent: %', sqlerrm;
end $$;

-- ---- 5.3 sale_items (foto do produto no momento da venda) -------------------------------
create table if not exists public.sale_items (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id),
  item_id           uuid not null references public.items(id),
  item_name         text not null,
  item_sku          text,
  item_barcode      text,
  quantity          numeric(12,3) not null check (quantity > 0),
  unit_price        numeric(12,2) not null check (unit_price >= 0),
  unit_cost         numeric(12,2),
  line_total        numeric(12,2) not null check (line_total >= 0),
  returned_quantity numeric(12,3) not null default 0,
  constraint sale_items_returned_ok check (returned_quantity >= 0 and returned_quantity <= quantity),
  unique (sale_id, item_id)
);

create index if not exists idx_sale_items_item on public.sale_items (item_id);

-- ---- 5.4 sale_payments ------------------------------------------------------------------
--   amount     = o que o CLIENTE pagou (já com desconto e juros)
--   fee_*      = taxa da OPERADORA (custo da loja) e net_amount = o que a loja recebe
create table if not exists public.sale_payments (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id),
  method            text not null check (method in ('pix','dinheiro','debito','credito_vista','credito_parcelado')),
  amount            numeric(12,2) not null check (amount > 0),
  installments      integer not null default 1 check (installments between 1 and 24),
  installment_value numeric(12,2),
  interest_percent  numeric(6,3) not null default 0 check (interest_percent >= 0),
  card_brand        text,
  fee_percent       numeric,
  fee_amount        numeric(12,2),
  net_amount        numeric(12,2),
  created_at        timestamptz not null default now(),
  constraint sale_payments_installments_ok check ((method = 'credito_parcelado') = (installments >= 2)),
  constraint sale_payments_card_brand_ok check (method not in ('debito','credito_vista','credito_parcelado') or card_brand is not null)
);

create index if not exists idx_sale_payments_sale on public.sale_payments (sale_id);

-- ---- 5.5 vínculo movimento → venda ----------------------------------------------------------
do $$
begin
  alter table public.movements
    add constraint movements_sale_id_fkey foreign key (sale_id) references public.sales(id);
exception when duplicate_object then null;
end $$;

-- ---- 5.6 item_serials: uma linha por UNIDADE FÍSICA de item com track_serial -----------------
--   status: estoque (disponível) | vendido (numa venda) | baixado (perda/uso/empréstimo/ajuste)
--   serial é único NO SISTEMA TODO (IMEI/serial não se repete entre produtos diferentes).
create table if not exists public.item_serials (
  id              uuid primary key default gen_random_uuid(),
  item_id         uuid not null references public.items(id) on delete restrict,
  serial          text not null,
  status          text not null default 'estoque' check (status in ('estoque', 'vendido', 'baixado')),
  sale_item_id    uuid references public.sale_items(id),
  movement_in_id  uuid references public.movements(id),
  movement_out_id uuid references public.movements(id),
  created_by      uuid references public.employees(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  sold_at         timestamptz,
  removed_at      timestamptz
);

create unique index if not exists item_serials_serial_key on public.item_serials (serial);
create index if not exists idx_item_serials_item_status   on public.item_serials (item_id, status);
create index if not exists idx_item_serials_sale_item     on public.item_serials (sale_item_id) where sale_item_id is not null;


-- ============================================================================
-- 6. AUDITORIA (imutável)
--    Responde: quem fez? quando? o que mudou?
-- ============================================================================
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,          -- ex.: item.price_changed, sale.created, employee.role_changed
  entity_type text not null,
  entity_id   text not null,
  changes     jsonb,                  -- { campo: {old, new} } ou detalhes da operação
  metadata    jsonb
);

create index if not exists idx_audit_entity  on public.audit_logs (entity_type, entity_id, created_at desc);
create index if not exists idx_audit_actor   on public.audit_logs (actor_id, created_at desc);
create index if not exists idx_audit_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_action  on public.audit_logs (action, created_at desc);

create or replace function public.audit_write(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_changes jsonb default null,
  p_metadata jsonb default null
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is not null then
    select full_name into v_name from public.employees where id = v_uid;
  end if;
  insert into public.audit_logs (actor_id, actor_name, action, entity_type, entity_id, changes, metadata)
  values (v_uid, v_name, p_action, p_entity_type, p_entity_id, p_changes, p_metadata);
end;
$$;

-- Bloqueia UPDATE/DELETE (usado em ledger, auditoria e pagamentos).
create or replace function public.audit_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Registros imutáveis: % em % não é permitido', tg_op, tg_table_name
    using errcode = 'P0001', hint = 'IMMUTABLE';
end;
$$;

-- Trigger genérico de auditoria: tg_argv[0] = entidade, tg_argv[1] = colunas ignoradas (csv).
create or replace function public.audit_row_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_entity text := tg_argv[0];
  v_ignore text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}'::text[]);
  v_old jsonb;
  v_new jsonb;
  v_changes jsonb := '{}'::jsonb;
  v_key text;
  v_action text;
begin
  if tg_op = 'INSERT' then
    perform public.audit_write(v_entity || '.created', v_entity, to_jsonb(new) ->> 'id',
                               jsonb_build_object('new', to_jsonb(new) - v_ignore));
    return new;
  elsif tg_op = 'DELETE' then
    perform public.audit_write(v_entity || '.deleted', v_entity, to_jsonb(old) ->> 'id',
                               jsonb_build_object('old', to_jsonb(old) - v_ignore));
    return old;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  for v_key in select jsonb_object_keys(v_new) loop
    continue when v_key = any (v_ignore);
    if v_old -> v_key is distinct from v_new -> v_key then
      v_changes := v_changes || jsonb_build_object(v_key, jsonb_build_object('old', v_old -> v_key, 'new', v_new -> v_key));
    end if;
  end loop;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  v_action := v_entity || '.updated';
  if v_entity = 'item' and (v_changes ? 'sale_price' or v_changes ? 'cost_price') then
    v_action := 'item.price_changed';
  elsif v_changes ? 'role' then
    v_action := v_entity || '.role_changed';
  elsif v_changes ? 'active' and (select count(*) from jsonb_object_keys(v_changes)) = 1 then
    v_action := v_entity || case when (v_new ->> 'active')::boolean then '.activated' else '.deactivated' end;
  end if;

  perform public.audit_write(v_action, v_entity, v_new ->> 'id', v_changes);
  return new;
end;
$$;


-- ============================================================================
-- 7. NOTIFICAÇÕES (transactional outbox)
--    O sistema grava o EVENTO junto com a operação; um serviço envia depois.
--    Telegram é só um canal — WhatsApp/e-mail entram depois sem mexer em vendas.
-- ============================================================================
create table if not exists public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null
                  check (event_type in ('SALE_COMPLETED','SALE_CANCELLED','SALE_RETURNED','LOW_STOCK','OUT_OF_STOCK','STOCK_ENTRY')),
  entity_type     text not null,
  entity_id       text not null,
  channel         text not null default 'telegram' check (channel in ('telegram')),
  dedupe_key      text not null,                 -- 1 evento por operação: retry nunca duplica
  payload         jsonb not null,                -- foto dos dados na hora do evento
  status          text not null default 'pending'
                  check (status in ('pending','sending','sent','failed','skipped')),
  attempts        integer not null default 0,
  max_attempts    integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  locked_at       timestamptz,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (channel, dedupe_key)
);

create index if not exists idx_outbox_due     on public.notification_outbox (status, next_attempt_at);
create index if not exists idx_outbox_created on public.notification_outbox (created_at desc);

-- Enfileira (no máximo uma vez por dedupe_key) se o evento estiver habilitado em app_settings.
create or replace function public.enqueue_notification(
  p_event text,
  p_entity_type text,
  p_entity_id text,
  p_dedupe text,
  p_payload jsonb
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not (public.setting_json('notify_events', '[]'::jsonb) ? p_event) then
    return;
  end if;
  insert into public.notification_outbox (event_type, entity_type, entity_id, dedupe_key, payload)
  values (p_event, p_entity_type, p_entity_id, p_dedupe, p_payload)
  on conflict (channel, dedupe_key) do nothing;
end;
$$;

-- Reivindica um lote para envio (concorrência segura: SKIP LOCKED).
create or replace function public.notification_claim(p_limit integer default 10)
returns setof public.notification_outbox
language sql security definer set search_path = public
as $$
  update public.notification_outbox o
     set status = 'sending', attempts = o.attempts + 1, locked_at = now(), updated_at = now()
   where o.id in (
     select id from public.notification_outbox
      where (status = 'pending' and next_attempt_at <= now())
         or (status = 'sending' and locked_at < now() - interval '5 minutes')
      order by created_at
      limit greatest(p_limit, 1)
      for update skip locked
   )
  returning o.*
$$;

create or replace function public.notification_mark_sent(p_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.notification_outbox
     set status = 'sent', sent_at = now(), last_error = null, locked_at = null, updated_at = now()
   where id = p_id
$$;

-- Falha: agenda nova tentativa com backoff exponencial, ou marca 'failed' (esgotou / erro permanente).
create or replace function public.notification_mark_failed(p_id uuid, p_error text, p_retryable boolean default true)
returns void
language sql security definer set search_path = public
as $$
  update public.notification_outbox
     set status = case when p_retryable and attempts < max_attempts then 'pending' else 'failed' end,
         next_attempt_at = now() + least(power(2, attempts) * interval '30 seconds', interval '1 hour'),
         last_error = left(p_error, 500),
         locked_at = null,
         updated_at = now()
   where id = p_id
$$;

-- Reenvio manual (admin/ceo) de notificação que falhou.
create or replace function public.notification_retry(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Apenas admin ou CEO podem reenviar notificações.' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  update public.notification_outbox
     set status = 'pending', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
   where id = p_id and status in ('failed', 'pending');
end;
$$;


-- ============================================================================
-- 8. TRIGGERS
-- ============================================================================

-- ---- 8.1 novo usuário do Auth → linha em employees ---------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.employees (id, username, full_name)
  values (
    new.id,
    split_part(new.email, '@', 1) || '-' || substr(new.id::text, 1, 8),
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- 8.2 ledger → estoque, com eventos de estoque na VIRADA ---------------------------------
-- Uma vez por operação: não repete o aviso enquanto o item continua baixo/zerado.
create or replace function public.apply_movement_to_item_quantity()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_delta numeric(12,3);
  v_item public.items%rowtype;
  v_before numeric(12,3);
  v_after numeric(12,3);
begin
  v_delta := case new.type
    when 'entrada' then new.quantity
    when 'saida'   then -new.quantity
    else case when new.adjustment_increases_stock then new.quantity else -new.quantity end
  end;

  update public.items
     set quantity = quantity + v_delta, updated_at = now()
   where id = new.item_id
  returning * into v_item;

  v_after := v_item.quantity;
  v_before := v_after - v_delta;

  if v_delta < 0 then
    if v_after <= 0 and v_before > 0 then
      perform public.enqueue_notification(
        'OUT_OF_STOCK', 'item', v_item.id::text, 'OUT_OF_STOCK:' || v_item.id || ':' || new.id,
        jsonb_build_object('item_id', v_item.id, 'name', v_item.name, 'sku', v_item.sku,
                           'barcode', v_item.barcode, 'unit', v_item.unit,
                           'quantity', v_after, 'min_stock', v_item.min_stock, 'occurred_at', now()));
    elsif v_item.min_stock > 0 and v_after <= v_item.min_stock and v_before > v_item.min_stock then
      perform public.enqueue_notification(
        'LOW_STOCK', 'item', v_item.id::text, 'LOW_STOCK:' || v_item.id || ':' || new.id,
        jsonb_build_object('item_id', v_item.id, 'name', v_item.name, 'sku', v_item.sku,
                           'barcode', v_item.barcode, 'unit', v_item.unit,
                           'quantity', v_after, 'min_stock', v_item.min_stock, 'occurred_at', now()));
    end if;
  elsif v_delta > 0 and new.subtype = 'compra' then
    perform public.enqueue_notification(
      'STOCK_ENTRY', 'item', v_item.id::text, 'STOCK_ENTRY:' || new.id,
      jsonb_build_object('item_id', v_item.id, 'name', v_item.name, 'sku', v_item.sku, 'unit', v_item.unit,
                         'added', v_delta, 'quantity', v_after, 'occurred_at', now()));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_movement on public.movements;
create trigger trg_apply_movement
  after insert on public.movements
  for each row execute function public.apply_movement_to_item_quantity();

-- ---- 8.3 imutabilidade -------------------------------------------------------------------------
drop trigger if exists trg_movements_immutable on public.movements;
create trigger trg_movements_immutable
  before update or delete on public.movements
  for each row execute function public.audit_block_mutation();

drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.audit_block_mutation();

drop trigger if exists trg_sale_payments_immutable on public.sale_payments;
create trigger trg_sale_payments_immutable
  before update or delete on public.sale_payments
  for each row execute function public.audit_block_mutation();

-- Venda nunca é apagada nem reescrita: só muda de status pelas funções da seção 10.
create or replace function public.sales_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Vendas não podem ser apagadas.' using errcode = 'P0001', hint = 'IMMUTABLE';
  end if;
  if new.id <> old.id or new.number <> old.number or new.idempotency_key <> old.idempotency_key
     or new.seller_id <> old.seller_id or new.customer_id is distinct from old.customer_id
     or new.subtotal <> old.subtotal or new.discount_amount <> old.discount_amount
     or new.interest_amount <> old.interest_amount or new.total <> old.total
     or new.created_at <> old.created_at or new.notes is distinct from old.notes then
    raise exception 'Dados históricos da venda não podem ser alterados.' using errcode = 'P0001', hint = 'IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sales_guard on public.sales;
create trigger trg_sales_guard
  before update or delete on public.sales
  for each row execute function public.sales_guard();

create or replace function public.sale_items_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Itens de venda não podem ser apagados.' using errcode = 'P0001', hint = 'IMMUTABLE';
  end if;
  if new.id <> old.id or new.sale_id <> old.sale_id or new.item_id <> old.item_id
     or new.quantity <> old.quantity or new.unit_price <> old.unit_price
     or new.line_total <> old.line_total or new.item_name <> old.item_name then
    raise exception 'Itens de venda só podem ter a quantidade devolvida alterada.' using errcode = 'P0001', hint = 'IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sale_items_guard on public.sale_items;
create trigger trg_sale_items_guard
  before update or delete on public.sale_items
  for each row execute function public.sale_items_guard();

-- ---- 8.4 auditoria automática ------------------------------------------------------------------
-- items.quantity fica de fora: o ledger de movimentações já registra quem/quando/motivo.
drop trigger if exists trg_audit_items on public.items;
create trigger trg_audit_items
  after insert or update or delete on public.items
  for each row execute function public.audit_row_change('item', 'quantity,updated_at');

drop trigger if exists trg_audit_employees on public.employees;
create trigger trg_audit_employees
  after insert or update or delete on public.employees
  for each row execute function public.audit_row_change('employee', '');

drop trigger if exists trg_audit_customers on public.customers;
create trigger trg_audit_customers
  after insert or update or delete on public.customers
  for each row execute function public.audit_row_change('customer', 'updated_at');


-- ============================================================================
-- 9. SEGURANÇA — RLS E PRIVILÉGIOS
-- ============================================================================
alter table public.employees           enable row level security;
alter table public.suppliers           enable row level security;
alter table public.items               enable row level security;
alter table public.movements           enable row level security;
alter table public.card_fee_rates      enable row level security;
alter table public.app_settings        enable row level security;
alter table public.customers           enable row level security;
alter table public.sales               enable row level security;
alter table public.sale_items          enable row level security;
alter table public.sale_payments       enable row level security;
alter table public.audit_logs          enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.item_serials        enable row level security;

-- Recria TODAS as policies (os nomes em bancos antigos divergiam do repositório).
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('employees','suppliers','items','movements','card_fee_rates','app_settings',
                        'customers','sales','sale_items','sale_payments','audit_logs','notification_outbox',
                        'item_serials')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- ---- 9.1 policies -----------------------------------------------------------------------------
-- employees: todo funcionário logado lê o quadro; só admin/ceo escreve.
create policy employees_select on public.employees for select using (auth.uid() is not null);
create policy employees_admin_write on public.employees for all
  using (public.is_admin()) with check (public.is_admin());

create policy suppliers_select on public.suppliers for select using (auth.uid() is not null);
create policy suppliers_write on public.suppliers for all
  using (public.is_manager()) with check (public.is_manager());

-- items: leitura para todos; cadastro/edição/preço só gerente+; excluir só admin/ceo.
create policy items_select on public.items for select using (auth.uid() is not null);
create policy items_insert on public.items for insert with check (public.is_manager());
create policy items_update on public.items for update using (public.is_manager()) with check (public.is_manager());
create policy items_delete on public.items for delete using (public.is_admin());

-- movements: leitura para todos; toda escrita (venda, cancelamento, lançamento manual) nasce
-- só pelas funções de negócio (create_sale, cancel_sale, return_sale_items, create_movement) —
-- por isso não existe policy de insert aqui (ver revoke em 9.2); a função valida o perfil por dentro.
create policy movements_select on public.movements for select using (auth.uid() is not null);

create policy card_fee_rates_select on public.card_fee_rates for select using (auth.uid() is not null);
create policy card_fee_rates_write on public.card_fee_rates for all
  using (public.is_admin()) with check (public.is_admin());

create policy app_settings_select on public.app_settings for select using (public.is_manager());
create policy app_settings_write on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

create policy customers_select on public.customers for select using (public.is_active_employee());
create policy customers_insert on public.customers for insert
  with check (public.is_active_employee() and created_by = auth.uid());
create policy customers_update on public.customers for update
  using (public.is_active_employee()) with check (public.is_active_employee());

-- vendas: gerente+ vê todas; vendedor vê só as próprias.
create policy sales_select on public.sales for select
  using (public.is_manager() or (public.is_active_employee() and seller_id = auth.uid()));
create policy sale_items_select on public.sale_items for select
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy sale_payments_select on public.sale_payments for select
  using (exists (select 1 from public.sales s where s.id = sale_id));

create policy audit_logs_select on public.audit_logs for select using (public.is_manager());
create policy outbox_select on public.notification_outbox for select using (public.is_manager());

-- item_serials: leitura para todo funcionário logado; escrita só pelas funções (create_movement, create_sale...).
create policy item_serials_select on public.item_serials for select using (auth.uid() is not null);

-- ---- 9.2 privilégios --------------------------------------------------------------------------
-- items.quantity NUNCA é escrito direto (nem no cadastro): só pelo ledger de movimentações.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'items'
     and column_name not in ('id', 'quantity', 'created_at');

  execute 'revoke insert, update on public.items from authenticated, anon';
  execute format('grant insert (%s) on public.items to authenticated', cols);
  execute format('grant update (%s) on public.items to authenticated', cols);
end $$;

-- Ledger, vendas, auditoria e fila: nada de escrita direta por usuários (só pelas funções).
-- movements.insert também: motivo, quantidade e (quando o item usa serial) os números de série
-- precisam ser validados juntos, então até o lançamento manual passa por create_movement().
revoke insert, update, delete on public.movements from authenticated, anon;
revoke insert, update, delete on public.sales, public.sale_items, public.sale_payments from authenticated, anon;
revoke insert, update, delete on public.audit_logs, public.notification_outbox from authenticated, anon;
revoke insert, update, delete on public.item_serials from authenticated, anon;
revoke delete on public.customers from authenticated, anon;
revoke insert, update, delete on public.app_settings from anon;


-- ============================================================================
-- 10. REGRAS DE NEGÓCIO (transacionais)
-- ============================================================================

-- ---- 10.0 create_movement --------------------------------------------------------------------
-- Lançamento manual de estoque (entrada, saída, ajuste — venda NUNCA passa por aqui).
-- Para item com track_serial: p_serials é obrigatório e vira a própria quantidade (uma unidade
-- = um número de série); em entrada/ajuste-aumenta cadastra os seriais novos, em saída/
-- ajuste-diminui exige que cada serial esteja em estoque e baixa exatamente essas unidades.
-- Assinatura mudou (ganhou p_supplier_id): descarta a versão antiga pra não sobrepor.
drop function if exists public.create_movement(text, uuid, numeric, text, numeric, text, boolean, jsonb);

create or replace function public.create_movement(
  p_type text,
  p_item_id uuid,
  p_quantity numeric,
  p_subtype text default null,
  p_unit_value numeric default null,
  p_reason text default null,
  p_adjustment_increases_stock boolean default null,
  p_serials jsonb default null,
  p_supplier_id uuid default null    -- só entrada: de quem veio. Uma vez informado, o item "lembra".
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item public.items%rowtype;
  v_serials text[];
  v_serial text;
  v_is_decrease boolean;
  v_quantity numeric(12,3);
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_movement_id uuid;
begin
  if not public.is_manager() then
    raise exception 'Apenas gerente, administrador ou CEO podem lançar movimentações de estoque.'
      using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;

  if p_type not in ('entrada', 'saida', 'ajuste') then
    raise exception 'Tipo de movimentação inválido.' using errcode = 'P0001', hint = 'INVALID_TYPE';
  end if;
  if p_type in ('entrada', 'saida') and coalesce(p_subtype, '') = '' then
    raise exception 'Informe o motivo da movimentação.' using errcode = 'P0001', hint = 'SUBTYPE_REQUIRED';
  end if;
  if coalesce(p_subtype, '') in ('venda', 'cancelamento', 'troca') then
    raise exception 'Esse tipo de movimentação só pode nascer de uma venda.' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_type = 'ajuste' then
    if p_adjustment_increases_stock is null then
      raise exception 'Informe a direção do ajuste.' using errcode = 'P0001', hint = 'INVALID_DIRECTION';
    end if;
    if v_reason is null then
      raise exception 'Motivo é obrigatório para ajuste.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
    end if;
  end if;
  if p_type = 'saida' and p_subtype = 'perda' and v_reason is null then
    raise exception 'Motivo da perda é obrigatório.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
  end if;

  select * into v_item from public.items where id = p_item_id for update;
  if not found then
    raise exception 'Produto não encontrado.' using errcode = 'P0001', hint = 'PRODUCT_NOT_FOUND';
  end if;

  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Fornecedor não encontrado.' using errcode = 'P0001', hint = 'SUPPLIER_NOT_FOUND';
  end if;
  -- "Compra" pede fornecedor uma vez só: se o item já lembra de qual foi, não precisa perguntar de novo.
  if p_type = 'entrada' and p_subtype = 'compra' and v_item.supplier_id is null and p_supplier_id is null then
    raise exception 'Informe o fornecedor dessa compra.' using errcode = 'P0001', hint = 'SUPPLIER_REQUIRED';
  end if;

  v_is_decrease := p_type = 'saida' or (p_type = 'ajuste' and not p_adjustment_increases_stock);

  if v_item.track_serial then
    if p_serials is null or jsonb_typeof(p_serials) <> 'array' then
      raise exception 'Informe os números de série de %.', v_item.name using errcode = 'P0001', hint = 'SERIALS_REQUIRED';
    end if;
    select array_agg(distinct nullif(btrim(s), '')) into v_serials from jsonb_array_elements_text(p_serials) s;
    v_serials := array_remove(v_serials, null);
    if coalesce(array_length(v_serials, 1), 0) = 0 then
      raise exception 'Informe os números de série de %.', v_item.name using errcode = 'P0001', hint = 'SERIALS_REQUIRED';
    end if;
    if jsonb_array_length(p_serials) <> array_length(v_serials, 1) then
      raise exception 'Número de série repetido ou em branco na lista.' using errcode = 'P0001', hint = 'SERIAL_DUPLICATE';
    end if;
    v_quantity := array_length(v_serials, 1);

    if v_is_decrease then
      for v_serial in select unnest(v_serials) loop
        if not exists (
          select 1 from public.item_serials
           where item_id = v_item.id and serial = v_serial and status = 'estoque'
           for update
        ) then
          raise exception 'Número de série % não está disponível em estoque para %.', v_serial, v_item.name
            using errcode = 'P0001', hint = 'SERIAL_NOT_AVAILABLE';
        end if;
      end loop;
    else
      for v_serial in select unnest(v_serials) loop
        if exists (select 1 from public.item_serials where serial = v_serial) then
          raise exception 'Número de série % já está cadastrado.', v_serial
            using errcode = 'P0001', hint = 'SERIAL_DUPLICATE';
        end if;
      end loop;
    end if;
  else
    if coalesce(p_quantity, 0) <= 0 then
      raise exception 'Quantidade deve ser maior que zero.' using errcode = 'P0001', hint = 'INVALID_QUANTITY';
    end if;
    v_quantity := p_quantity;
  end if;

  if v_is_decrease and v_quantity > v_item.quantity then
    raise exception 'Estoque insuficiente para %: disponível %, solicitado %.',
      v_item.name, trim_scale(v_item.quantity), trim_scale(v_quantity)
      using errcode = 'P0001', hint = 'INSUFFICIENT_STOCK';
  end if;

  insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                adjustment_increases_stock, source_channel, created_by)
  values (p_item_id, p_type, nullif(p_subtype, ''), v_quantity, p_unit_value, v_reason,
          case when p_type = 'ajuste' then p_adjustment_increases_stock else null end, 'web', v_uid)
  returning id into v_movement_id;

  if v_item.track_serial then
    if v_is_decrease then
      update public.item_serials
         set status = 'baixado', movement_out_id = v_movement_id, removed_at = now()
       where item_id = v_item.id and serial = any(v_serials) and status = 'estoque';
    else
      insert into public.item_serials (item_id, serial, status, movement_in_id, created_by)
      select v_item.id, s, 'estoque', v_movement_id, v_uid from unnest(v_serials) s;
    end if;
  end if;

  -- Lembra o fornecedor pro item: só pergunta de novo se alguém escolher um diferente.
  if p_type = 'entrada' and p_supplier_id is not null and p_supplier_id is distinct from v_item.supplier_id then
    update public.items set supplier_id = p_supplier_id, updated_at = now() where id = v_item.id;
  end if;

  return jsonb_build_object('movement_id', v_movement_id, 'quantity', v_quantity);
end;
$$;

-- ---- 10.0b create_stock_entry -----------------------------------------------------------------
-- Entrada de estoque em LOTE (uma "nota" com vários produtos de uma vez): cada elemento de
-- p_items já chega do cliente AGRUPADO por item+fornecedor (mesmo item + mesmo fornecedor =
-- uma linha só, com a quantidade somada; item diferente ou fornecedor diferente = linha própria).
-- Aqui só processa: chama create_movement() linha a linha, tudo dentro da MESMA transação —
-- se uma linha falhar, nenhuma é gravada.
create or replace function public.create_stock_entry(
  p_items jsonb,                  -- [{ item_id, quantity?, unit_value?, supplier_id?, serials?, subtype?, reason? }]
  p_subtype text default 'compra',
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_elem jsonb;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
begin
  if not public.is_manager() then
    raise exception 'Apenas gerente, administrador ou CEO podem lançar movimentações de estoque.'
      using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione ao menos um item à entrada.' using errcode = 'P0001', hint = 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Máximo de 200 itens por entrada.' using errcode = 'P0001', hint = 'TOO_MANY_ITEMS';
  end if;

  -- ordem estável por item_id: evita deadlock com outra entrada em lote acontecendo ao mesmo tempo.
  for v_elem in select value from jsonb_array_elements(p_items) order by value ->> 'item_id' loop
    if coalesce(v_elem ->> 'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Produto inválido na entrada.' using errcode = 'P0001', hint = 'INVALID_ITEM';
    end if;

    v_line := public.create_movement(
      p_type => 'entrada',
      p_item_id => (v_elem ->> 'item_id')::uuid,
      p_quantity => case when v_elem ->> 'quantity' is not null then (v_elem ->> 'quantity')::numeric else null end,
      p_subtype => coalesce(v_elem ->> 'subtype', p_subtype),
      p_unit_value => case when v_elem ->> 'unit_value' is not null then (v_elem ->> 'unit_value')::numeric else null end,
      p_reason => coalesce(v_elem ->> 'reason', p_reason),
      p_adjustment_increases_stock => null,
      p_serials => v_elem -> 'serials',
      p_supplier_id => case when v_elem ->> 'supplier_id' is not null then (v_elem ->> 'supplier_id')::uuid else null end
    );
    v_lines := v_lines || jsonb_build_object('item_id', v_elem ->> 'item_id', 'movement_id', v_line ->> 'movement_id', 'quantity', v_line -> 'quantity');
  end loop;

  return jsonb_build_object('lines', v_lines, 'count', jsonb_array_length(v_lines));
end;
$$;

-- ---- 10.1 create_sale ------------------------------------------------------------------------
-- Uma única transação: valida → trava produtos → calcula → grava venda, itens, pagamento,
-- movimentações (que baixam o estoque) → auditoria → evento de notificação.
-- Se qualquer passo falhar, NADA é gravado.
-- Assinatura mudou (ganhou p_trade_in): descarta a versão antiga pra não sobrepor (Postgres trata
-- listas de parâmetros diferentes como funções distintas, não como substituição).
drop function if exists public.create_sale(uuid, uuid, jsonb, numeric, text, integer, numeric, text, text);

create or replace function public.create_sale(
  p_idempotency_key uuid,
  p_customer_id uuid,
  p_items jsonb,                       -- [{ "item_id": uuid, "quantity": n }]
  p_discount_amount numeric default 0, -- em R$
  p_payment_method text default 'pix', -- pix | dinheiro | debito | credito_vista | credito_parcelado
  p_installments integer default 1,
  p_interest_percent numeric default 0,-- juros cobrado do cliente (só credito_parcelado)
  p_card_brand text default null,
  p_notes text default null,
  p_trade_in jsonb default null        -- { "item_name": text, "category": text|null, "value": n } | null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_emp public.employees%rowtype;
  v_existing public.sales%rowtype;
  v_customer_name text;
  v_elem jsonb;
  v_req record;
  v_serial text;
  v_item public.items%rowtype;
  v_sale_item_id uuid;
  v_lines jsonb := '[]'::jsonb;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := round(coalesce(p_discount_amount, 0), 2);
  v_base numeric(12,2);
  v_interest numeric(12,2) := 0;
  v_interest_pct numeric(6,3);
  v_total numeric(12,2);
  v_method text := p_payment_method;
  v_installments integer := coalesce(p_installments, 1);
  v_is_card boolean;
  v_brand text := lower(nullif(btrim(p_card_brand), ''));
  v_fee_key integer;
  v_fee_pct numeric;
  v_fee numeric(12,2);
  v_net numeric(12,2);
  v_limit numeric;
  v_disc_pct numeric;
  v_sale_id uuid;
  v_number bigint;
  v_stock jsonb := '[]'::jsonb;
  v_ti_name text;
  v_ti_category text;
  v_ti_value numeric(12,2) := 0;
  v_ti_item_id uuid;
begin
  -- Quem vende vem SEMPRE da sessão autenticada, nunca do navegador.
  if v_uid is null then
    raise exception 'Sessão inválida. Entre novamente.' using errcode = 'P0001', hint = 'NOT_AUTHENTICATED';
  end if;
  select * into v_emp from public.employees where id = v_uid and active;
  if not found then
    raise exception 'Seu usuário não tem permissão para vender.' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if p_idempotency_key is null then
    raise exception 'Chave de idempotência obrigatória.' using errcode = 'P0001', hint = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  -- Idempotência: serializa requisições repetidas da mesma venda (duplo clique, retry de rede).
  perform pg_advisory_xact_lock(hashtextextended('create_sale:' || p_idempotency_key::text, 0));
  select * into v_existing from public.sales where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.seller_id <> v_uid then
      raise exception 'Chave de idempotência já usada por outra venda.' using errcode = 'P0001', hint = 'IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('sale_id', v_existing.id, 'number', v_existing.number,
                              'code', public.sale_code(v_existing.number), 'total', v_existing.total,
                              'status', v_existing.status, 'already_processed', true);
  end if;

  -- Carrinho
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Adicione ao menos um produto à venda.' using errcode = 'P0001', hint = 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'Máximo de 100 itens por venda.' using errcode = 'P0001', hint = 'TOO_MANY_ITEMS';
  end if;
  for v_elem in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_elem ->> 'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'Produto inválido no carrinho.' using errcode = 'P0001', hint = 'INVALID_ITEM';
    end if;
    if coalesce(v_elem ->> 'quantity', '') !~ '^[0-9]+(\.[0-9]{1,3})?$' or (v_elem ->> 'quantity')::numeric <= 0 then
      raise exception 'Quantidade inválida no carrinho.' using errcode = 'P0001', hint = 'INVALID_QUANTITY';
    end if;
    if v_elem ? 'serials' and jsonb_typeof(v_elem -> 'serials') <> 'array' then
      raise exception 'Números de série inválidos no carrinho.' using errcode = 'P0001', hint = 'INVALID_ITEM';
    end if;
  end loop;

  if p_customer_id is not null then
    select name into v_customer_name from public.customers where id = p_customer_id and active;
    if not found then
      raise exception 'Cliente não encontrado ou inativo.' using errcode = 'P0001', hint = 'CUSTOMER_NOT_FOUND';
    end if;
  end if;

  -- Entrada (troca): produto que o cliente entregou como parte do pagamento.
  if p_trade_in is not null then
    v_ti_name := btrim(coalesce(p_trade_in ->> 'item_name', ''));
    v_ti_category := nullif(btrim(coalesce(p_trade_in ->> 'category', '')), '');
    if coalesce(p_trade_in ->> 'value', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Informe o valor do produto recebido de entrada.' using errcode = 'P0001', hint = 'TRADE_IN_VALUE_REQUIRED';
    end if;
    v_ti_value := round((p_trade_in ->> 'value')::numeric, 2);
    if v_ti_name = '' then
      raise exception 'Informe o nome do produto recebido de entrada.' using errcode = 'P0001', hint = 'TRADE_IN_ITEM_REQUIRED';
    end if;
    if v_ti_value <= 0 then
      raise exception 'Informe o valor do produto recebido de entrada.' using errcode = 'P0001', hint = 'TRADE_IN_VALUE_REQUIRED';
    end if;
  end if;

  -- Pagamento
  if v_method is null or v_method not in ('pix','dinheiro','debito','credito_vista','credito_parcelado') then
    raise exception 'Forma de pagamento inválida.' using errcode = 'P0001', hint = 'INVALID_PAYMENT';
  end if;
  v_is_card := v_method in ('debito','credito_vista','credito_parcelado');
  if v_method = 'credito_parcelado' then
    if v_installments < 2 or v_installments > 18 then
      raise exception 'Parcelamento deve ser de 2 a 18 vezes.' using errcode = 'P0001', hint = 'INVALID_INSTALLMENTS';
    end if;
  elsif v_installments <> 1 then
    raise exception 'Essa forma de pagamento não permite parcelamento.' using errcode = 'P0001', hint = 'INVALID_INSTALLMENTS';
  end if;
  if coalesce(p_interest_percent, 0) < 0 or coalesce(p_interest_percent, 0) > 100 then
    raise exception 'Percentual de juros inválido.' using errcode = 'P0001', hint = 'INVALID_INTEREST';
  end if;
  v_interest_pct := round(coalesce(p_interest_percent, 0), 3);
  if v_method <> 'credito_parcelado' and v_interest_pct <> 0 then
    raise exception 'Juros só se aplicam ao crédito parcelado.' using errcode = 'P0001', hint = 'INVALID_INTEREST';
  end if;
  if v_interest_pct > public.setting_numeric('max_interest_percent', 50) then
    raise exception 'Juros acima do máximo permitido (máx. %).',
      trim_scale(public.setting_numeric('max_interest_percent', 50))::text || '%'
      using errcode = 'P0001', hint = 'INVALID_INTEREST';
  end if;
  if v_is_card and v_brand is null then
    raise exception 'Informe a bandeira do cartão.' using errcode = 'P0001', hint = 'CARD_BRAND_REQUIRED';
  end if;
  if not v_is_card then v_brand := null; end if;
  v_brand := case v_brand when 'mastercard' then 'master' when 'hipercard' then 'hiper'
                          when 'american express' then 'amex' else v_brand end;

  -- Trava as linhas dos produtos SEMPRE em ordem de id: sem deadlock e sem vender a mesma
  -- unidade para dois vendedores ao mesmo tempo.
  for v_req in
    select item_id, sum(qty) as qty, coalesce(array_agg(serial) filter (where serial is not null), '{}') as serials
      from (
        select (e ->> 'item_id')::uuid as item_id, (e ->> 'quantity')::numeric(12,3) as qty, null::text as serial
          from jsonb_array_elements(p_items) e
        union all
        select (e ->> 'item_id')::uuid, 0, jsonb_array_elements_text(coalesce(e -> 'serials', '[]'::jsonb))
          from jsonb_array_elements(p_items) e
      ) x
     group by item_id order by item_id
  loop
    select * into v_item from public.items where id = v_req.item_id for update;
    if not found then
      raise exception 'Produto não encontrado.' using errcode = 'P0001', hint = 'PRODUCT_NOT_FOUND';
    end if;
    if not v_item.active then
      raise exception 'Produto inativo: %.', v_item.name using errcode = 'P0001', hint = 'PRODUCT_INACTIVE';
    end if;
    if v_item.sale_price is null or v_item.sale_price <= 0 then
      raise exception 'Produto sem preço de venda: %.', v_item.name using errcode = 'P0001', hint = 'NO_PRICE';
    end if;
    if v_item.quantity < v_req.qty then
      raise exception 'Estoque insuficiente para %: disponível %, solicitado %.',
        v_item.name, trim_scale(v_item.quantity), trim_scale(v_req.qty)
        using errcode = 'P0001', hint = 'INSUFFICIENT_STOCK';
    end if;

    if v_item.track_serial then
      if v_req.qty <> coalesce(array_length(v_req.serials, 1), 0) then
        raise exception 'Bipe um número de série para cada unidade de %: esperado %, recebido %.',
          v_item.name, trim_scale(v_req.qty), coalesce(array_length(v_req.serials, 1), 0)
          using errcode = 'P0001', hint = 'SERIAL_COUNT_MISMATCH';
      end if;
      for v_serial in select unnest(v_req.serials) loop
        if not exists (
          select 1 from public.item_serials
           where item_id = v_item.id and serial = v_serial and status = 'estoque'
           for update
        ) then
          raise exception 'Número de série % não está disponível em estoque para %.', v_serial, v_item.name
            using errcode = 'P0001', hint = 'SERIAL_NOT_AVAILABLE';
        end if;
      end loop;
    elsif coalesce(array_length(v_req.serials, 1), 0) > 0 then
      raise exception '% não usa número de série.', v_item.name using errcode = 'P0001', hint = 'SERIAL_NOT_APPLICABLE';
    end if;

    -- O preço vem do banco (nunca do navegador).
    v_line_total := round(v_item.sale_price * v_req.qty, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'sku', v_item.sku, 'barcode', v_item.barcode,
      'unit', v_item.unit, 'quantity', v_req.qty, 'unit_price', v_item.sale_price,
      'unit_cost', v_item.cost_price, 'line_total', v_line_total,
      'stock_before', v_item.quantity, 'stock_after', v_item.quantity - v_req.qty,
      'serials', to_jsonb(v_req.serials));
  end loop;

  -- Desconto: validado contra o limite do perfil de quem vende.
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Desconto inválido.' using errcode = 'P0001', hint = 'INVALID_DISCOUNT';
  end if;
  v_limit := public.setting_numeric('discount_limit_percent_' || v_emp.role,
                                    case when public.role_rank(v_emp.role) >= 3 then 100 else 0 end);
  v_disc_pct := case when v_subtotal = 0 then 0 else v_discount / v_subtotal * 100 end;
  if v_disc_pct > v_limit + 0.0001 then
    raise exception 'Desconto acima do permitido para o seu perfil (máx. %).', trim_scale(v_limit)::text || '%'
      using errcode = 'P0001', hint = 'DISCOUNT_NOT_ALLOWED';
  end if;

  -- Totais: subtotal − desconto + juros − entrada. "Valor da venda" e "valor pago pelo cliente" são
  -- coisas diferentes e ficam separados (subtotal, discount_amount, interest_amount, trade_in_amount, total).
  v_base := v_subtotal - v_discount;
  if v_base <= 0 then
    raise exception 'O total da venda precisa ser maior que zero.' using errcode = 'P0001', hint = 'INVALID_TOTAL';
  end if;
  if v_method = 'credito_parcelado' then
    v_interest := round(v_base * v_interest_pct / 100, 2);
  end if;
  if v_ti_value > 0 and v_ti_value >= v_base + v_interest then
    raise exception 'O valor de entrada não pode ser maior ou igual ao total da venda.'
      using errcode = 'P0001', hint = 'TRADE_IN_EXCEEDS_TOTAL';
  end if;
  v_total := v_base + v_interest - v_ti_value;

  -- Taxa da operadora (custo da loja): vem de card_fee_rates.
  if v_is_card then
    v_fee_key := case v_method when 'debito' then 0 when 'credito_vista' then 1 else v_installments end;
    select fee_percent into v_fee_pct from public.card_fee_rates
     where lower(brand) = v_brand and installments = v_fee_key;
    if not found then
      raise exception 'Sem taxa cadastrada para % em % (%).', upper(v_brand),
        case when v_fee_key = 0 then 'débito' else v_fee_key || 'x' end, v_method
        using errcode = 'P0001', hint = 'FEE_NOT_FOUND';
    end if;
    v_fee := round(v_total * v_fee_pct / 100, 2);
    v_net := v_total - v_fee;
  end if;

  -- Grava
  insert into public.sales (idempotency_key, seller_id, customer_id, subtotal, discount_amount,
                            interest_amount, trade_in_amount, total, notes)
  values (p_idempotency_key, v_uid, p_customer_id, v_subtotal, v_discount, v_interest, v_ti_value, v_total,
          nullif(btrim(p_notes), ''))
  returning id, number into v_sale_id, v_number;

  insert into public.sale_payments (sale_id, method, amount, installments, installment_value,
                                    interest_percent, card_brand, fee_percent, fee_amount, net_amount)
  values (v_sale_id, v_method, v_total, v_installments, round(v_total / v_installments, 2),
          v_interest_pct, v_brand, v_fee_pct, v_fee, v_net);

  for v_elem in select value from jsonb_array_elements(v_lines) loop
    insert into public.sale_items (sale_id, item_id, item_name, item_sku, item_barcode, quantity,
                                   unit_price, unit_cost, line_total)
    values (v_sale_id, (v_elem ->> 'item_id')::uuid, v_elem ->> 'name', v_elem ->> 'sku',
            v_elem ->> 'barcode', (v_elem ->> 'quantity')::numeric, (v_elem ->> 'unit_price')::numeric,
            (v_elem ->> 'unit_cost')::numeric, (v_elem ->> 'line_total')::numeric)
    returning id into v_sale_item_id;

    -- O trigger do ledger (8.2) baixa o estoque e dispara LOW_STOCK / OUT_OF_STOCK na virada.
    insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                  source_channel, created_by, sale_id)
    values ((v_elem ->> 'item_id')::uuid, 'saida', 'venda', (v_elem ->> 'quantity')::numeric,
            (v_elem ->> 'unit_price')::numeric, 'Venda #' || public.sale_code(v_number), 'web', v_uid, v_sale_id);

    if jsonb_array_length(coalesce(v_elem -> 'serials', '[]'::jsonb)) > 0 then
      update public.item_serials
         set status = 'vendido', sale_item_id = v_sale_item_id, sold_at = now()
       where item_id = (v_elem ->> 'item_id')::uuid
         and serial = any (select jsonb_array_elements_text(v_elem -> 'serials'))
         and status = 'estoque';
    end if;

    v_stock := v_stock || jsonb_build_object('item_id', v_elem -> 'item_id', 'name', v_elem -> 'name',
                                             'before', v_elem -> 'stock_before', 'after', v_elem -> 'stock_after');
  end loop;

  -- Entrada (troca): cadastra o produto recebido como seminovo e dá entrada de 1 unidade,
  -- vinculada a esta venda. custo = valor da entrada (é o que a loja "pagou" por ele).
  if v_ti_value > 0 then
    insert into public.items (name, category, condition, cost_price, active, created_by)
    values (v_ti_name, v_ti_category, 'seminovo', v_ti_value, true, v_uid)
    returning id into v_ti_item_id;

    insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                  source_channel, created_by, sale_id)
    values (v_ti_item_id, 'entrada', 'troca', 1, v_ti_value,
            'Recebido como entrada na venda #' || public.sale_code(v_number), 'web', v_uid, v_sale_id);

    update public.sales set trade_in_item_id = v_ti_item_id where id = v_sale_id;
  end if;

  perform public.audit_write('sale.created', 'sale', v_sale_id::text,
    jsonb_build_object('number', v_number, 'total', v_total, 'subtotal', v_subtotal,
                       'discount', v_discount, 'interest', v_interest, 'method', v_method,
                       'installments', v_installments, 'items', v_lines,
                       'trade_in', case when v_ti_value > 0 then
                         jsonb_build_object('item_id', v_ti_item_id, 'name', v_ti_name, 'value', v_ti_value)
                       else null end));

  perform public.enqueue_notification('SALE_COMPLETED', 'sale', v_sale_id::text,
    'SALE_COMPLETED:' || v_sale_id,
    jsonb_build_object(
      'sale_id', v_sale_id, 'code', public.sale_code(v_number),
      'seller', v_emp.full_name, 'customer', v_customer_name,
      'items', v_lines, 'stock', v_stock,
      'subtotal', v_subtotal, 'discount', v_discount, 'interest', v_interest,
      'trade_in', case when v_ti_value > 0 then jsonb_build_object('name', v_ti_name, 'value', v_ti_value) else null end,
      'total', v_total,
      'payment', jsonb_build_object('method', v_method, 'installments', v_installments,
                                    'installment_value', round(v_total / v_installments, 2),
                                    'interest_percent', v_interest_pct, 'card_brand', v_brand,
                                    'fee_percent', v_fee_pct, 'fee_amount', v_fee, 'net_amount', v_net),
      'occurred_at', now()));

  return jsonb_build_object('sale_id', v_sale_id, 'number', v_number, 'code', public.sale_code(v_number),
                            'total', v_total, 'status', 'concluida', 'already_processed', false);
end;
$$;

-- ---- 10.2 cancel_sale --------------------------------------------------------------------------
-- Devolve ao estoque o que a venda tirou, registra quem/quando/por quê e avisa o CEO.
-- A venda NÃO é apagada: muda para 'cancelada'.
create or replace function public.cancel_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_emp public.employees%rowtype;
  v_sale public.sales%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_si public.sale_items%rowtype;
  v_ti_item public.items%rowtype;
  v_seller text;
  v_customer text;
  v_items jsonb := '[]'::jsonb;
begin
  select * into v_emp from public.employees where id = v_uid and active;
  if not found or public.role_rank(v_emp.role) < 3 then
    raise exception 'Apenas gerente, admin ou CEO podem cancelar vendas.' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Informe o motivo do cancelamento.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0001', hint = 'SALE_NOT_FOUND';
  end if;
  if v_sale.status = 'cancelada' then
    return jsonb_build_object('sale_id', v_sale.id, 'status', 'cancelada', 'already_processed', true);
  end if;
  if v_sale.status <> 'concluida' then
    raise exception 'Só dá para cancelar venda concluída e sem devoluções. Use a devolução.'
      using errcode = 'P0001', hint = 'INVALID_STATUS';
  end if;

  perform 1 from public.items
   where id in (select item_id from public.sale_items where sale_id = p_sale_id)
      or id = v_sale.trade_in_item_id
   order by id for update;

  for v_si in select * from public.sale_items where sale_id = p_sale_id order by item_id loop
    insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                  source_channel, created_by, sale_id)
    values (v_si.item_id, 'entrada', 'cancelamento', v_si.quantity, v_si.unit_price,
            'Cancelamento da venda #' || public.sale_code(v_sale.number) || ': ' || v_reason,
            'web', v_uid, v_sale.id);

    -- Devolve ao estoque os números de série vendidos nesse item (cancelamento é sempre total:
    -- só é permitido quando a venda ainda não teve nenhuma devolução).
    update public.item_serials
       set status = 'estoque', sale_item_id = null, sold_at = null
     where sale_item_id = v_si.id and status = 'vendido';

    v_items := v_items || jsonb_build_object('name', v_si.item_name, 'quantity', v_si.quantity);
  end loop;

  -- Entrada (troca): tira do estoque o produto que o cliente tinha entregado — a menos que já
  -- tenha sido revendido, caso em que o cancelamento é bloqueado (não dá pra desfazer sem rastro).
  if v_sale.trade_in_item_id is not null then
    select * into v_ti_item from public.items where id = v_sale.trade_in_item_id;
    if v_ti_item.quantity < 1 then
      raise exception 'Não é possível cancelar: o produto recebido de entrada (%) já foi revendido.', v_ti_item.name
        using errcode = 'P0001', hint = 'TRADE_IN_ALREADY_SOLD';
    end if;
    insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                  source_channel, created_by, sale_id)
    values (v_ti_item.id, 'saida', 'outros', 1, v_sale.trade_in_amount,
            'Cancelamento da venda #' || public.sale_code(v_sale.number) || ': ' || v_reason,
            'web', v_uid, v_sale.id);
    update public.items set active = false, updated_at = now() where id = v_ti_item.id;
  end if;

  update public.sales
     set status = 'cancelada', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = v_reason,
         refunded_amount = total, updated_at = now()
   where id = p_sale_id;

  select full_name into v_seller from public.employees where id = v_sale.seller_id;
  select name into v_customer from public.customers where id = v_sale.customer_id;

  perform public.audit_write('sale.cancelled', 'sale', v_sale.id::text,
    jsonb_build_object('number', v_sale.number, 'total', v_sale.total, 'reason', v_reason));

  perform public.enqueue_notification('SALE_CANCELLED', 'sale', v_sale.id::text,
    'SALE_CANCELLED:' || v_sale.id,
    jsonb_build_object('sale_id', v_sale.id, 'code', public.sale_code(v_sale.number),
                       'seller', v_seller, 'customer', v_customer, 'total', v_sale.total,
                       'cancelled_by', v_emp.full_name, 'reason', v_reason, 'items', v_items,
                       'occurred_at', now()));

  return jsonb_build_object('sale_id', v_sale.id, 'status', 'cancelada', 'already_processed', false);
end;
$$;

-- ---- 10.3 return_sale_items (devolução parcial ou total) -------------------------------------
create or replace function public.return_sale_items(
  p_sale_id uuid,
  p_items jsonb,                -- [{ "sale_item_id": uuid, "quantity": n }]
  p_reason text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_emp public.employees%rowtype;
  v_sale public.sales%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_req record;
  v_si public.sale_items%rowtype;
  v_track_serial boolean;
  v_serial text;
  v_refund numeric(12,2) := 0;
  v_returned jsonb := '[]'::jsonb;
  v_all_returned boolean;
  v_seller text;
  v_customer text;
begin
  select * into v_emp from public.employees where id = v_uid and active;
  if not found or public.role_rank(v_emp.role) < 3 then
    raise exception 'Apenas gerente, admin ou CEO podem registrar devoluções.' using errcode = 'P0001', hint = 'FORBIDDEN';
  end if;
  if length(v_reason) < 3 then
    raise exception 'Informe o motivo da devolução.' using errcode = 'P0001', hint = 'REASON_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception 'Chave de idempotência obrigatória.' using errcode = 'P0001', hint = 'IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Selecione ao menos um item para devolver.' using errcode = 'P0001', hint = 'EMPTY_CART';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('return_sale:' || p_idempotency_key::text, 0));
  if exists (select 1 from public.audit_logs
              where action = 'sale.returned' and metadata ->> 'idempotency_key' = p_idempotency_key::text) then
    return jsonb_build_object('sale_id', p_sale_id, 'already_processed', true);
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'Venda não encontrada.' using errcode = 'P0001', hint = 'SALE_NOT_FOUND';
  end if;
  if v_sale.status not in ('concluida', 'parcialmente_devolvida') then
    raise exception 'Essa venda não aceita devolução (status: %).', v_sale.status
      using errcode = 'P0001', hint = 'INVALID_STATUS';
  end if;

  perform 1 from public.items
   where id in (select item_id from public.sale_items where sale_id = p_sale_id)
   order by id for update;

  for v_req in
    select sale_item_id, sum(qty) as qty, coalesce(array_agg(serial) filter (where serial is not null), '{}') as serials
      from (
        select (e ->> 'sale_item_id')::uuid as sale_item_id, (e ->> 'quantity')::numeric(12,3) as qty, null::text as serial
          from jsonb_array_elements(p_items) e
        union all
        select (e ->> 'sale_item_id')::uuid, 0, jsonb_array_elements_text(coalesce(e -> 'serials', '[]'::jsonb))
          from jsonb_array_elements(p_items) e
      ) x
     group by sale_item_id order by sale_item_id
  loop
    select * into v_si from public.sale_items where id = v_req.sale_item_id and sale_id = p_sale_id for update;
    if not found then
      raise exception 'Item não pertence a essa venda.' using errcode = 'P0001', hint = 'INVALID_ITEM';
    end if;
    if v_req.qty <= 0 or v_req.qty > v_si.quantity - v_si.returned_quantity then
      raise exception 'Quantidade a devolver de % excede o que foi vendido e ainda não devolvido (%).',
        v_si.item_name, trim_scale(v_si.quantity - v_si.returned_quantity)
        using errcode = 'P0001', hint = 'INVALID_QUANTITY';
    end if;

    select track_serial into v_track_serial from public.items where id = v_si.item_id;
    if v_track_serial then
      if v_req.qty <> coalesce(array_length(v_req.serials, 1), 0) then
        raise exception 'Selecione um número de série para cada unidade devolvida de %: esperado %, recebido %.',
          v_si.item_name, trim_scale(v_req.qty), coalesce(array_length(v_req.serials, 1), 0)
          using errcode = 'P0001', hint = 'SERIAL_COUNT_MISMATCH';
      end if;
      for v_serial in select unnest(v_req.serials) loop
        update public.item_serials
           set status = 'estoque', sale_item_id = null, sold_at = null
         where serial = v_serial and item_id = v_si.item_id and sale_item_id = v_si.id and status = 'vendido';
        if not found then
          raise exception 'Número de série % não está vendido nesse item dessa venda.', v_serial
            using errcode = 'P0001', hint = 'SERIAL_NOT_SOLD_HERE';
        end if;
      end loop;
    elsif coalesce(array_length(v_req.serials, 1), 0) > 0 then
      raise exception '% não usa número de série.', v_si.item_name using errcode = 'P0001', hint = 'SERIAL_NOT_APPLICABLE';
    end if;

    insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                  source_channel, created_by, sale_id)
    values (v_si.item_id, 'entrada', 'devolucao', v_req.qty, v_si.unit_price,
            'Devolução da venda #' || public.sale_code(v_sale.number) || ': ' || v_reason,
            'web', v_uid, v_sale.id);

    update public.sale_items set returned_quantity = returned_quantity + v_req.qty where id = v_si.id;

    -- Reembolso proporcional (desconto e juros entram na mesma proporção do subtotal).
    v_refund := v_refund + round(v_req.qty * v_si.unit_price * v_sale.total / v_sale.subtotal, 2);
    v_returned := v_returned || jsonb_build_object('name', v_si.item_name, 'quantity', v_req.qty);
  end loop;

  select bool_and(returned_quantity = quantity) into v_all_returned
    from public.sale_items where sale_id = p_sale_id;
  if v_all_returned then
    v_refund := v_sale.total - v_sale.refunded_amount;   -- fecha exatamente, sem resto de arredondamento
  else
    v_refund := least(v_refund, v_sale.total - v_sale.refunded_amount);
  end if;

  update public.sales
     set status = case when v_all_returned then 'devolvida' else 'parcialmente_devolvida' end,
         refunded_amount = refunded_amount + v_refund, updated_at = now()
   where id = p_sale_id;

  select full_name into v_seller from public.employees where id = v_sale.seller_id;
  select name into v_customer from public.customers where id = v_sale.customer_id;

  perform public.audit_write('sale.returned', 'sale', v_sale.id::text,
    jsonb_build_object('number', v_sale.number, 'items', v_returned, 'refund', v_refund, 'reason', v_reason),
    jsonb_build_object('idempotency_key', p_idempotency_key));

  perform public.enqueue_notification('SALE_RETURNED', 'sale', v_sale.id::text,
    'SALE_RETURNED:' || p_idempotency_key,
    jsonb_build_object('sale_id', v_sale.id, 'code', public.sale_code(v_sale.number),
                       'seller', v_seller, 'customer', v_customer, 'refund', v_refund,
                       'returned_by', v_emp.full_name, 'reason', v_reason, 'items', v_returned,
                       'full', v_all_returned, 'occurred_at', now()));

  return jsonb_build_object('sale_id', v_sale.id, 'refund', v_refund,
                            'status', case when v_all_returned then 'devolvida' else 'parcialmente_devolvida' end,
                            'already_processed', false);
end;
$$;


-- ============================================================================
-- 11. RELATÓRIOS
--     SECURITY INVOKER: o RLS decide o que cada perfil enxerga (vendedor só as suas vendas).
-- ============================================================================

-- Faturamento = vendas não canceladas menos o que foi devolvido.
create or replace function public.sales_revenue(p_from timestamptz, p_to timestamptz)
returns numeric
language sql stable
as $$
  select coalesce(sum(total - refunded_amount), 0)
    from public.sales
   where created_at >= p_from and created_at < p_to
     and status in ('concluida', 'parcialmente_devolvida', 'devolvida')
$$;

create or replace function public.sales_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql stable
as $$
  with s as (
    select * from public.sales
     where created_at >= p_from and created_at < p_to
       and status in ('concluida', 'parcialmente_devolvida', 'devolvida')
  ),
  kpi as (
    select coalesce(sum(total - refunded_amount), 0) as revenue,
           count(*) filter (where status <> 'devolvida') as sales_count,
           coalesce(sum(interest_amount), 0) as interest,
           coalesce(sum(discount_amount), 0) as discounts
      from s
  ),
  units as (
    select coalesce(sum(si.quantity - si.returned_quantity), 0) as units_sold
      from public.sale_items si join s on s.id = si.sale_id
  ),
  pay as (
    select p.method,
           coalesce(sum(p.amount * (s.total - s.refunded_amount) / nullif(s.total, 0)), 0) as amount,
           count(*) as sales
      from public.sale_payments p join s on s.id = p.sale_id
     group by p.method
  ),
  sellers as (
    select e.full_name as seller, sum(s.total - s.refunded_amount) as revenue, count(*) as sales
      from s join public.employees e on e.id = s.seller_id
     group by e.full_name
  ),
  daily as (
    select (s.created_at at time zone 'America/Sao_Paulo')::date as day,
           sum(s.total - s.refunded_amount) as revenue, count(*) as sales
      from s group by 1
  )
  select jsonb_build_object(
    'revenue', (select revenue from kpi),
    'sales_count', (select sales_count from kpi),
    'ticket_avg', (select case when sales_count = 0 then 0 else round(revenue / sales_count, 2) end from kpi),
    'interest', (select interest from kpi),
    'discounts', (select discounts from kpi),
    'units_sold', (select units_sold from units),
    'by_payment', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', round(amount, 2), 'sales', sales) order by amount desc) from pay), '[]'::jsonb),
    'by_seller',  coalesce((select jsonb_agg(jsonb_build_object('seller', seller, 'revenue', revenue, 'sales', sales) order by revenue desc) from sellers), '[]'::jsonb),
    'daily',      coalesce((select jsonb_agg(jsonb_build_object('day', day, 'revenue', revenue, 'sales', sales) order by day) from daily), '[]'::jsonb)
  )
$$;

-- Limites de venda do usuário logado (a tela usa para avisar antes de tentar; o banco confere de novo).
-- SECURITY DEFINER porque vendedor não pode ler app_settings.
create or replace function public.sale_limits()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'discount_limit_percent',
      public.setting_numeric('discount_limit_percent_' || coalesce(public.current_role_name(), 'vendedor'),
                             case when public.is_manager() then 100 else 0 end),
    'max_interest_percent', public.setting_numeric('max_interest_percent', 50)
  )
$$;

-- Resumo do estoque (calculado no banco: nada de somar milhares de linhas no navegador).
create or replace function public.inventory_summary()
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'active_items', count(*) filter (where active),
    'units',        coalesce(sum(quantity) filter (where active), 0),
    'cost_value',   coalesce(sum(quantity * cost_price) filter (where active and quantity > 0), 0),
    'sale_value',   coalesce(sum(quantity * sale_price) filter (where active and quantity > 0), 0)
  )
  from public.items
$$;

-- Estoque baixo: mínimo definido, saldo > 0 e <= mínimo.
-- Esgotado: saldo <= 0 em produto que JÁ teve movimento (produto recém-cadastrado, sem
-- nenhuma entrada, não é "esgotado" — ainda nem foi estocado).
create or replace function public.stock_alerts()
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'low', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sku', sku, 'quantity', quantity, 'min_stock', min_stock, 'unit', unit) order by name)
                       from public.items where active and min_stock > 0 and quantity > 0 and quantity <= min_stock), '[]'::jsonb),
    'out', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'sku', i.sku, 'unit', i.unit) order by i.name)
                       from public.items i
                      where i.active and i.quantity <= 0
                        and exists (select 1 from public.movements m where m.item_id = i.id)), '[]'::jsonb)
  )
$$;

-- Resumo mensal de movimentações (relatórios de entradas/saídas).
create or replace view public.monthly_movement_summary as
select
  date_trunc('month', created_at) as month,
  type,
  item_id,
  sum(quantity)    as total_quantity,
  sum(total_value) as total_value,
  count(*)         as movement_count
from public.movements
group by 1, 2, 3;

-- View roda com as permissões de quem consulta (respeita o RLS de movements) e não é
-- acessível sem login. Sem isso ela ignorava o RLS e qualquer pessoa com a chave pública
-- (anon) lia quantidades e valores de movimentação.
alter view public.monthly_movement_summary set (security_invoker = true);
revoke all on public.monthly_movement_summary from anon;


-- ============================================================================
-- 12. PERMISSÃO DE EXECUÇÃO
-- ============================================================================
-- Só o serviço de notificações (service_role) mexe na fila; ninguém escreve auditoria à mão.
revoke execute on function public.notification_claim(integer)                     from public, anon, authenticated;
revoke execute on function public.notification_mark_sent(uuid)                    from public, anon, authenticated;
revoke execute on function public.notification_mark_failed(uuid, text, boolean)   from public, anon, authenticated;
revoke execute on function public.enqueue_notification(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_write(text, text, text, jsonb, jsonb)     from public, anon, authenticated;
grant  execute on function public.notification_claim(integer)                     to service_role;
grant  execute on function public.notification_mark_sent(uuid)                    to service_role;
grant  execute on function public.notification_mark_failed(uuid, text, boolean)   to service_role;
grant  execute on function public.notification_retry(uuid)                        to authenticated;

-- Regras de venda e de movimentação: só usuário logado (a função ainda confere perfil por dentro).
revoke execute on function public.create_movement(text, uuid, numeric, text, numeric, text, boolean, jsonb, uuid) from public, anon;
grant  execute on function public.create_movement(text, uuid, numeric, text, numeric, text, boolean, jsonb, uuid) to authenticated;
revoke execute on function public.create_stock_entry(jsonb, text, text) from public, anon;
grant  execute on function public.create_stock_entry(jsonb, text, text) to authenticated;
revoke execute on function public.create_sale(uuid, uuid, jsonb, numeric, text, integer, numeric, text, text, jsonb) from public, anon;
revoke execute on function public.cancel_sale(uuid, text)                          from public, anon;
revoke execute on function public.return_sale_items(uuid, jsonb, text, uuid)       from public, anon;
grant  execute on function public.create_sale(uuid, uuid, jsonb, numeric, text, integer, numeric, text, text, jsonb) to authenticated;
grant  execute on function public.cancel_sale(uuid, text)                          to authenticated;
grant  execute on function public.return_sale_items(uuid, jsonb, text, uuid)       to authenticated;
grant  execute on function public.sales_revenue(timestamptz, timestamptz)          to authenticated;
grant  execute on function public.sales_dashboard(timestamptz, timestamptz)        to authenticated;
grant  execute on function public.stock_alerts()                                   to authenticated;
grant  execute on function public.sale_limits()                                    to authenticated;
grant  execute on function public.inventory_summary()                              to authenticated;


-- ============================================================================
-- 13. REALTIME — alerta de estoque baixo em tempo real
--     (idempotente: o Postgres não tem "add to publication if not exists")
-- ============================================================================
do $$
begin
  alter publication supabase_realtime add table public.items;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- Faz a API do Supabase enxergar tabelas/funções novas sem esperar.
notify pgrst, 'reload schema';


-- ============================================================================
-- PRIMEIRO ACESSO
--   1. Crie o usuário em Authentication > Users (o trigger 8.1 cria o employees).
--   2. Promova a admin/ceo (ou use a tela Funcionários, se já houver um admin):
--        update public.employees set role = 'ceo' where id = '<uuid do usuário>';
-- ============================================================================
