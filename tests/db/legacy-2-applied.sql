-- =====================================================================
-- 001 · FUNDAÇÃO
--   • papéis (ceo, admin, gerente, vendedor) e funções de permissão
--   • configurações da plataforma (app_settings)
--   • auditoria imutável (audit_logs) + triggers
--   • fila de notificações (notification_outbox) — Telegram é só um canal
--   • travas de segurança: estoque só muda via movimentação; preço só gerente+
--   • ledger de movimentações imutável, com novos subtipos e vínculo de venda
--
-- Idempotente (pode rodar de novo) e aditiva: não apaga colunas nem dados.
-- Rodar ANTES da 002. Ver supabase/migrations/README.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Ajustes de compatibilidade com o banco de produção (drift)
-- ---------------------------------------------------------------------
alter table public.employees add column if not exists username text;

create table if not exists public.card_fee_rates (
  id          uuid primary key default gen_random_uuid(),
  brand       text not null,
  installments integer not null,          -- 0 = débito, 1 = crédito à vista, N = N parcelas
  fee_percent numeric not null,           -- taxa que a OPERADORA cobra da loja
  updated_at  timestamptz not null default now()
);

do $$
begin
  create unique index if not exists card_fee_rates_brand_installments_key
    on public.card_fee_rates (brand, installments);
exception when others then
  raise notice 'Não foi possível criar índice único em card_fee_rates: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 1. Papéis
-- ---------------------------------------------------------------------
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

-- admin e ceo (substitui a versão antiga, que só reconhecia 'admin')
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

-- Trigger de criação de usuário (já preenche username; role vem do default 'vendedor').
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

-- ---------------------------------------------------------------------
-- 2. Configurações
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 3. Auditoria (imutável)
-- ---------------------------------------------------------------------
create table if not exists public.audit_logs (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  entity_type text not null,
  entity_id   text not null,
  changes     jsonb,
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

create or replace function public.audit_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Registros imutáveis: % em % não é permitido', tg_op, tg_table_name
    using errcode = 'P0001', hint = 'IMMUTABLE';
end;
$$;

drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable
  before update or delete on public.audit_logs
  for each row execute function public.audit_block_mutation();

-- Trigger genérico: tg_argv[0] = entidade, tg_argv[1] = colunas ignoradas (csv).
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

-- quantity: coberto pelo ledger de movimentações (quem, quando, motivo).
drop trigger if exists trg_audit_items on public.items;
create trigger trg_audit_items
  after insert or update or delete on public.items
  for each row execute function public.audit_row_change('item', 'quantity,updated_at');

drop trigger if exists trg_audit_employees on public.employees;
create trigger trg_audit_employees
  after insert or update or delete on public.employees
  for each row execute function public.audit_row_change('employee', '');

-- ---------------------------------------------------------------------
-- 4. Fila de notificações (transactional outbox)
-- ---------------------------------------------------------------------
create table if not exists public.notification_outbox (
  id              uuid primary key default gen_random_uuid(),
  event_type      text not null
                  check (event_type in ('SALE_COMPLETED','SALE_CANCELLED','SALE_RETURNED','LOW_STOCK','OUT_OF_STOCK','STOCK_ENTRY')),
  entity_type     text not null,
  entity_id       text not null,
  channel         text not null default 'telegram' check (channel in ('telegram')),
  dedupe_key      text not null,
  payload         jsonb not null,
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

-- Enfileira (no máximo uma vez por dedupe_key) se o evento estiver habilitado.
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

-- Reivindica lote para envio (concorrência segura: SKIP LOCKED).
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

-- Falha: agenda nova tentativa com backoff exponencial ou marca como 'failed'.
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

-- Retry manual (admin/ceo) de notificação que falhou.
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

-- ---------------------------------------------------------------------
-- 5. Ledger de movimentações: novos subtipos, vínculo com venda, imutável
-- ---------------------------------------------------------------------
alter table public.items add column if not exists description text;
alter table public.movements add column if not exists sale_id uuid;

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
    ('compra','devolucao','transferencia','uso','perda','venda','emprestimo','cancelamento','outros'));

-- Coerência tipo × subtipo (NOT VALID: não reprova histórico, barra tudo que for novo).
alter table public.movements
  add constraint movements_subtype_type_check
  check (
    subtype is null
    or subtype = 'outros'
    or (type = 'entrada' and subtype in ('compra','devolucao','transferencia','cancelamento'))
    or (type = 'saida'   and subtype in ('uso','perda','venda','emprestimo'))
    or (type = 'ajuste')
  ) not valid;

create index if not exists idx_movements_sale_id on public.movements (sale_id) where sale_id is not null;

drop trigger if exists trg_movements_immutable on public.movements;
create trigger trg_movements_immutable
  before update or delete on public.movements
  for each row execute function public.audit_block_mutation();

-- Estoque nunca negativo (NOT VALID: não quebra se já existir item negativo hoje).
do $$
begin
  alter table public.items
    add constraint items_quantity_not_negative check (quantity >= 0) not valid;
exception when duplicate_object then null;
end $$;

-- Mantém items.quantity em dia e dispara eventos de estoque na VIRADA
-- (uma vez por operação — sem repetir alerta enquanto o item continua baixo/zerado).
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

-- ---------------------------------------------------------------------
-- 6. RLS e permissões — quem pode o quê
-- ---------------------------------------------------------------------
-- Recria TODAS as policies das tabelas abaixo (nomes em produção divergiam do repo).
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('employees', 'items', 'movements', 'suppliers', 'card_fee_rates')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

alter table public.employees       enable row level security;
alter table public.items           enable row level security;
alter table public.movements       enable row level security;
alter table public.suppliers       enable row level security;
alter table public.card_fee_rates  enable row level security;
alter table public.app_settings    enable row level security;
alter table public.audit_logs      enable row level security;
alter table public.notification_outbox enable row level security;

-- employees: todo funcionário logado lê o quadro; só admin/ceo escreve.
create policy employees_select on public.employees for select using (auth.uid() is not null);
create policy employees_admin_write on public.employees for all
  using (public.is_admin()) with check (public.is_admin());

-- items: leitura para todos; cadastro/edição/preço só gerente+; excluir só admin.
create policy items_select on public.items for select using (auth.uid() is not null);
create policy items_insert on public.items for insert with check (public.is_manager());
create policy items_update on public.items for update using (public.is_manager()) with check (public.is_manager());
create policy items_delete on public.items for delete using (public.is_admin());

-- movements: leitura para todos; lançamento manual só gerente+ e NUNCA de venda/cancelamento
-- (esses nascem exclusivamente nas funções de venda).
create policy movements_select on public.movements for select using (auth.uid() is not null);
create policy movements_insert on public.movements for insert
  with check (
    public.is_manager()
    and created_by = auth.uid()
    and sale_id is null
    and coalesce(subtype, '') not in ('venda', 'cancelamento')
  );

create policy suppliers_select on public.suppliers for select using (auth.uid() is not null);
create policy suppliers_write on public.suppliers for all
  using (public.is_manager()) with check (public.is_manager());

create policy card_fee_rates_select on public.card_fee_rates for select using (auth.uid() is not null);
create policy card_fee_rates_write on public.card_fee_rates for all
  using (public.is_admin()) with check (public.is_admin());

create policy app_settings_select on public.app_settings for select using (public.is_manager());
create policy app_settings_write on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());

create policy audit_logs_select on public.audit_logs for select using (public.is_manager());
create policy outbox_select on public.notification_outbox for select using (public.is_manager());

-- Privilégios de coluna: `items.quantity` NUNCA é escrito direto — só pelo ledger.
do $$
declare cols_insert text; cols_update text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols_insert
    from information_schema.columns
   where table_schema = 'public' and table_name = 'items'
     and column_name not in ('id', 'quantity', 'created_at');
  cols_update := cols_insert;

  execute 'revoke insert, update on public.items from authenticated, anon';
  execute format('grant insert (%s) on public.items to authenticated', cols_insert);
  execute format('grant update (%s) on public.items to authenticated', cols_update);
end $$;

-- Ledger, auditoria e fila: nada de escrita direta por usuários.
revoke update, delete on public.movements from authenticated, anon;
revoke insert, update, delete on public.audit_logs, public.notification_outbox from authenticated, anon;
revoke insert, update, delete on public.app_settings from anon;

revoke execute on function public.notification_claim(integer) from public, anon, authenticated;
revoke execute on function public.notification_mark_sent(uuid) from public, anon, authenticated;
revoke execute on function public.notification_mark_failed(uuid, text, boolean) from public, anon, authenticated;
revoke execute on function public.enqueue_notification(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.audit_write(text, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.notification_claim(integer) to service_role;
grant execute on function public.notification_mark_sent(uuid) to service_role;
grant execute on function public.notification_mark_failed(uuid, text, boolean) to service_role;
grant execute on function public.notification_retry(uuid) to authenticated;


-- =====================================================================
-- 002 · CLIENTES + VENDAS
--   • customers, sales, sale_items, sale_payments
--   • create_sale / cancel_sale / return_sale_items: TRANSACIONAIS, com trava de
--     linha (sem vender a mesma unidade duas vezes), idempotência, auditoria e
--     evento de notificação gravado na MESMA transação da venda (outbox)
--   • funções de leitura do dashboard
--
-- Depende da 001. Idempotente e aditiva.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Clientes
-- ---------------------------------------------------------------------
create table if not exists public.customers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  document   text check (document is null or document ~ '^[0-9]{11}$' or document ~ '^[0-9]{14}$'),
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
create index if not exists idx_customers_name on public.customers (lower(name));
create index if not exists idx_customers_created on public.customers (created_at desc);

drop trigger if exists trg_audit_customers on public.customers;
create trigger trg_audit_customers
  after insert or update or delete on public.customers
  for each row execute function public.audit_row_change('customer', 'updated_at');

-- ---------------------------------------------------------------------
-- 2. Vendas
-- ---------------------------------------------------------------------
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
  notes           text,
  cancelled_at    timestamptz,
  cancelled_by    uuid references public.employees(id),
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sales_total_consistent check (total = subtotal - discount_amount + interest_amount),
  constraint sales_cancel_consistent check (status <> 'cancelada' or (cancelled_at is not null and cancel_reason is not null))
);

create index if not exists idx_sales_created  on public.sales (created_at desc);
create index if not exists idx_sales_seller   on public.sales (seller_id, created_at desc);
create index if not exists idx_sales_customer on public.sales (customer_id, created_at desc);
create index if not exists idx_sales_status   on public.sales (status, created_at desc);

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

create table if not exists public.sale_payments (
  id                uuid primary key default gen_random_uuid(),
  sale_id           uuid not null references public.sales(id),
  method            text not null check (method in ('pix','dinheiro','debito','credito_vista','credito_parcelado')),
  amount            numeric(12,2) not null check (amount > 0),
  installments      integer not null default 1 check (installments between 1 and 24),
  installment_value numeric(12,2),
  interest_percent  numeric(6,3) not null default 0 check (interest_percent >= 0),
  card_brand        text,
  fee_percent       numeric,           -- taxa da OPERADORA (custo da loja)
  fee_amount        numeric(12,2),
  net_amount        numeric(12,2),     -- o que a loja realmente recebe
  created_at        timestamptz not null default now(),
  constraint sale_payments_installments_ok check ((method = 'credito_parcelado') = (installments >= 2)),
  constraint sale_payments_card_brand_ok check (method not in ('debito','credito_vista','credito_parcelado') or card_brand is not null)
);

create index if not exists idx_sale_payments_sale on public.sale_payments (sale_id);

do $$
begin
  alter table public.movements
    add constraint movements_sale_id_fkey foreign key (sale_id) references public.sales(id);
exception when duplicate_object then null;
end $$;

-- Venda nunca é apagada nem reescrita: só muda de status pelas funções abaixo.
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
create trigger trg_sales_guard before update or delete on public.sales
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
create trigger trg_sale_items_guard before update or delete on public.sale_items
  for each row execute function public.sale_items_guard();

drop trigger if exists trg_sale_payments_immutable on public.sale_payments;
create trigger trg_sale_payments_immutable before update or delete on public.sale_payments
  for each row execute function public.audit_block_mutation();

-- ---------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------
alter table public.customers     enable row level security;
alter table public.sales         enable row level security;
alter table public.sale_items    enable row level security;
alter table public.sale_payments enable row level security;

do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename in ('customers', 'sales', 'sale_items', 'sale_payments')
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

create policy customers_select on public.customers for select using (public.is_active_employee());
create policy customers_insert on public.customers for insert
  with check (public.is_active_employee() and created_by = auth.uid());
create policy customers_update on public.customers for update
  using (public.is_active_employee()) with check (public.is_active_employee());

-- gerente+ vê todas as vendas; vendedor vê só as próprias.
create policy sales_select on public.sales for select
  using (public.is_manager() or (public.is_active_employee() and seller_id = auth.uid()));
create policy sale_items_select on public.sale_items for select
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy sale_payments_select on public.sale_payments for select
  using (exists (select 1 from public.sales s where s.id = sale_id));

-- Escrita SÓ pelas funções abaixo.
revoke insert, update, delete on public.sales, public.sale_items, public.sale_payments from authenticated, anon;
revoke delete on public.customers from authenticated, anon;

-- ---------------------------------------------------------------------
-- 4. create_sale
-- ---------------------------------------------------------------------
create or replace function public.create_sale(
  p_idempotency_key uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_discount_amount numeric default 0,
  p_payment_method text default 'pix',
  p_installments integer default 1,
  p_interest_percent numeric default 0,
  p_card_brand text default null,
  p_notes text default null
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
  v_item public.items%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_line_total numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2) := round(coalesce(p_discount_amount, 0), 2);
  v_base numeric(12,2);
  v_interest numeric(12,2) := 0;
  v_interest_pct numeric(6,3) := round(coalesce(p_interest_percent, 0), 3);
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
begin
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

  -- Serializa requisições repetidas da mesma venda (duplo clique, retry de rede).
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
  end loop;

  if p_customer_id is not null then
    select name into v_customer_name from public.customers where id = p_customer_id and active;
    if not found then
      raise exception 'Cliente não encontrado ou inativo.' using errcode = 'P0001', hint = 'CUSTOMER_NOT_FOUND';
    end if;
  end if;

  -- Pagamento
  if v_method not in ('pix','dinheiro','debito','credito_vista','credito_parcelado') then
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
  if v_method <> 'credito_parcelado' and v_interest_pct <> 0 then
    raise exception 'Juros só se aplicam ao crédito parcelado.' using errcode = 'P0001', hint = 'INVALID_INTEREST';
  end if;
  if v_interest_pct > public.setting_numeric('max_interest_percent', 50) then
    raise exception 'Juros acima do máximo permitido (%%%).', trim_scale(public.setting_numeric('max_interest_percent', 50))
      using errcode = 'P0001', hint = 'INVALID_INTEREST';
  end if;
  if v_is_card and v_brand is null then
    raise exception 'Informe a bandeira do cartão.' using errcode = 'P0001', hint = 'CARD_BRAND_REQUIRED';
  end if;
  if not v_is_card then v_brand := null; end if;
  v_brand := case v_brand when 'mastercard' then 'master' when 'hipercard' then 'hiper'
                          when 'american express' then 'amex' else v_brand end;

  -- Trava as linhas dos produtos SEMPRE em ordem de id (evita deadlock e venda dupla).
  for v_req in
    select (e ->> 'item_id')::uuid as item_id, sum((e ->> 'quantity')::numeric(12,3)) as qty
      from jsonb_array_elements(p_items) e
     group by 1 order by 1
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

    v_line_total := round(v_item.sale_price * v_req.qty, 2);
    v_subtotal := v_subtotal + v_line_total;
    v_lines := v_lines || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'sku', v_item.sku, 'barcode', v_item.barcode,
      'unit', v_item.unit, 'quantity', v_req.qty, 'unit_price', v_item.sale_price,
      'unit_cost', v_item.cost_price, 'line_total', v_line_total,
      'stock_before', v_item.quantity, 'stock_after', v_item.quantity - v_req.qty);
  end loop;

  -- Desconto (validado contra o perfil do vendedor — nunca confia no navegador)
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Desconto inválido.' using errcode = 'P0001', hint = 'INVALID_DISCOUNT';
  end if;
  v_limit := public.setting_numeric('discount_limit_percent_' || v_emp.role,
                                    case when public.role_rank(v_emp.role) >= 3 then 100 else 0 end);
  v_disc_pct := case when v_subtotal = 0 then 0 else v_discount / v_subtotal * 100 end;
  if v_disc_pct > v_limit + 0.0001 then
    raise exception 'Desconto acima do permitido para o seu perfil (máx. %%%).', trim_scale(v_limit)
      using errcode = 'P0001', hint = 'DISCOUNT_NOT_ALLOWED';
  end if;

  v_base := v_subtotal - v_discount;
  if v_base <= 0 then
    raise exception 'O total da venda precisa ser maior que zero.' using errcode = 'P0001', hint = 'INVALID_TOTAL';
  end if;
  if v_method = 'credito_parcelado' then
    v_interest := round(v_base * v_interest_pct / 100, 2);
  end if;
  v_total := v_base + v_interest;

  -- Taxa da operadora (custo da loja) — vem da tabela card_fee_rates, nunca do navegador.
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
                            interest_amount, total, notes)
  values (p_idempotency_key, v_uid, p_customer_id, v_subtotal, v_discount, v_interest, v_total,
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
            (v_elem ->> 'unit_cost')::numeric, (v_elem ->> 'line_total')::numeric);

    -- O trigger do ledger baixa o estoque (e dispara LOW_STOCK / OUT_OF_STOCK na virada).
    insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                  source_channel, created_by, sale_id)
    values ((v_elem ->> 'item_id')::uuid, 'saida', 'venda', (v_elem ->> 'quantity')::numeric,
            (v_elem ->> 'unit_price')::numeric, 'Venda #' || public.sale_code(v_number), 'web', v_uid, v_sale_id);

    v_stock := v_stock || jsonb_build_object('item_id', v_elem -> 'item_id', 'name', v_elem -> 'name',
                                             'before', v_elem -> 'stock_before', 'after', v_elem -> 'stock_after');
  end loop;

  perform public.audit_write('sale.created', 'sale', v_sale_id::text,
    jsonb_build_object('number', v_number, 'total', v_total, 'subtotal', v_subtotal,
                       'discount', v_discount, 'interest', v_interest, 'method', v_method,
                       'installments', v_installments, 'items', v_lines));

  perform public.enqueue_notification('SALE_COMPLETED', 'sale', v_sale_id::text,
    'SALE_COMPLETED:' || v_sale_id,
    jsonb_build_object(
      'sale_id', v_sale_id, 'code', public.sale_code(v_number),
      'seller', v_emp.full_name, 'customer', v_customer_name,
      'items', v_lines, 'stock', v_stock,
      'subtotal', v_subtotal, 'discount', v_discount, 'interest', v_interest, 'total', v_total,
      'payment', jsonb_build_object('method', v_method, 'installments', v_installments,
                                    'installment_value', round(v_total / v_installments, 2),
                                    'interest_percent', v_interest_pct, 'card_brand', v_brand,
                                    'fee_percent', v_fee_pct, 'fee_amount', v_fee, 'net_amount', v_net),
      'occurred_at', now()));

  return jsonb_build_object('sale_id', v_sale_id, 'number', v_number, 'code', public.sale_code(v_number),
                            'total', v_total, 'status', 'concluida', 'already_processed', false);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. cancel_sale
-- ---------------------------------------------------------------------
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
   order by id for update;

  for v_si in select * from public.sale_items where sale_id = p_sale_id order by item_id loop
    insert into public.movements (item_id, type, subtype, quantity, unit_value, reason,
                                  source_channel, created_by, sale_id)
    values (v_si.item_id, 'entrada', 'cancelamento', v_si.quantity, v_si.unit_price,
            'Cancelamento da venda #' || public.sale_code(v_sale.number) || ': ' || v_reason,
            'web', v_uid, v_sale.id);
    v_items := v_items || jsonb_build_object('name', v_si.item_name, 'quantity', v_si.quantity);
  end loop;

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

-- ---------------------------------------------------------------------
-- 6. return_sale_items (devolução parcial ou total)
-- ---------------------------------------------------------------------
create or replace function public.return_sale_items(
  p_sale_id uuid,
  p_items jsonb,
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
    select (e ->> 'sale_item_id')::uuid as sale_item_id, sum((e ->> 'quantity')::numeric(12,3)) as qty
      from jsonb_array_elements(p_items) e
     group by 1 order by 1
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

-- ---------------------------------------------------------------------
-- 7. Leitura do dashboard (SECURITY INVOKER: o RLS decide o que cada perfil enxerga)
-- ---------------------------------------------------------------------
-- Faturamento = vendas não canceladas menos o que foi devolvido.
create or replace function public.sales_revenue(p_from timestamptz, p_to timestamptz)
returns numeric
language sql stable
as $$
  select coalesce(sum(total - refunded_amount), 0)
    from public.sales
   where created_at >= p_from and created_at < p_to and status in ('concluida', 'parcialmente_devolvida', 'devolvida')
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
     group by e.full_name order by 2 desc
  ),
  daily as (
    select (s.created_at at time zone 'America/Sao_Paulo')::date as day,
           sum(s.total - s.refunded_amount) as revenue, count(*) as sales
      from s group by 1 order by 1
  )
  select jsonb_build_object(
    'revenue', (select revenue from kpi),
    'sales_count', (select sales_count from kpi),
    'ticket_avg', (select case when sales_count = 0 then 0 else round(revenue / sales_count, 2) end from kpi),
    'interest', (select interest from kpi),
    'discounts', (select discounts from kpi),
    'units_sold', (select units_sold from units),
    'by_payment', coalesce((select jsonb_agg(jsonb_build_object('method', method, 'amount', round(amount, 2), 'sales', sales)) from pay), '[]'::jsonb),
    'by_seller',  coalesce((select jsonb_agg(jsonb_build_object('seller', seller, 'revenue', revenue, 'sales', sales)) from sellers), '[]'::jsonb),
    'daily',      coalesce((select jsonb_agg(jsonb_build_object('day', day, 'revenue', revenue, 'sales', sales)) from daily), '[]'::jsonb)
  )
$$;

-- Estoque baixo: mínimo definido e saldo <= mínimo (mas ainda > 0).
-- Esgotado: saldo <= 0 em produto que já teve movimento (produto novo, sem entrada, não é "esgotado").
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

-- ---------------------------------------------------------------------
-- 8. Permissões de execução
-- ---------------------------------------------------------------------
revoke execute on function public.create_sale(uuid, uuid, jsonb, numeric, text, integer, numeric, text, text) from public, anon;
revoke execute on function public.cancel_sale(uuid, text) from public, anon;
revoke execute on function public.return_sale_items(uuid, jsonb, text, uuid) from public, anon;
grant execute on function public.create_sale(uuid, uuid, jsonb, numeric, text, integer, numeric, text, text) to authenticated;
grant execute on function public.cancel_sale(uuid, text) to authenticated;
grant execute on function public.return_sale_items(uuid, jsonb, text, uuid) to authenticated;
grant execute on function public.sales_revenue(timestamptz, timestamptz) to authenticated;
grant execute on function public.sales_dashboard(timestamptz, timestamptz) to authenticated;
grant execute on function public.stock_alerts() to authenticated;
