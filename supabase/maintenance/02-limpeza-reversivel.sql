-- ============================================================================
-- 02 — LIMPEZA REVERSÍVEL.  NÃO RODE ANTES DE REVISAR O RESULTADO DE 01-auditoria-dry-run.sql.
--
-- Como funciona:
--   1. Tira uma FOTO (backup) das linhas que vai tocar, no schema cleanup_backup.
--   2. Você preenche as listas de IDs na seção "PLANO" (nada vem preenchido: sem plano, não faz nada).
--   3. Roda dentro de uma transação que termina em ROLLBACK. Confira o resumo; se estiver certo, troque
--      o ROLLBACK final por COMMIT e rode de novo.
--   4. Para desfazer depois: 03-desfazer-limpeza.sql.
--
-- Regras de segurança:
--   • NADA é apagado (DELETE). Duplicado/teste é DESATIVADO (active = false) e o SKU/código ganha o
--     sufixo "-DUP-<id>" para liberar a unicidade. Venda e histórico continuam intactos.
--   • Estoque de duplicado NÃO é "sumido": a transferência de saldo para o produto principal é feita
--     por movimentações de ajuste (ledger), com motivo — o ledger é imutável e auditável.
--   • Vendas antigas não são reescritas: contas duplicadas de funcionário são VINCULADAS (merged_into).
-- ============================================================================

create schema if not exists cleanup_backup;

-- 1) FOTO ----------------------------------------------------------------------------------------
create table if not exists cleanup_backup.items_snapshot     as select now() as snapshot_at, * from public.items     where false;
create table if not exists cleanup_backup.employees_snapshot as select now() as snapshot_at, * from public.employees where false;

-- 2) PLANO (preencha depois de revisar a auditoria) -------------------------------------------------
-- Cada linha: (id do produto a DESATIVAR, id do produto PRINCIPAL que fica — ou NULL se for lixo de teste).
create temp table plano_itens (duplicado uuid primary key, principal uuid);
-- exemplo (NÃO descomente sem conferir):
-- insert into plano_itens values ('<id do GARMIN 265 sem SKU>', '<id do GARMIN 265 com SKU>');
-- insert into plano_itens values ('<id do RELÓGIO ESPORTIVO / xx>', null);

-- Cada linha: (id da conta duplicada, id da conta PRINCIPAL da mesma pessoa).
create temp table plano_funcionarios (duplicada uuid primary key, principal uuid not null);
-- exemplo:
-- insert into plano_funcionarios values ('<id de andersonajorge@gmail.com>', '<id de Alvireno>');
-- insert into plano_funcionarios values ('<id de aurilenozero40@gmail.com>', '<id de Aurileno>');

-- Correções de nome/SKU (id, novo nome, novo SKU ou NULL para manter).
create temp table plano_correcoes (id uuid primary key, novo_nome text, novo_sku text);
-- exemplo:
-- insert into plano_correcoes values ('<id garmin oregon 750>', 'GARMIN OREGON 750', null);
-- insert into plano_correcoes values ('<id GARMINN EDGE 550>', 'GARMIN EDGE 550', null);

begin;

insert into cleanup_backup.items_snapshot
select now(), i.* from public.items i
 where i.id in (select duplicado from plano_itens) or i.id in (select principal from plano_itens where principal is not null)
    or i.id in (select id from plano_correcoes);

insert into cleanup_backup.employees_snapshot
select now(), e.* from public.employees e
 where e.id in (select duplicada from plano_funcionarios) or e.id in (select principal from plano_funcionarios);

-- 3a) Saldo do duplicado vai para o principal (ajustes no ledger, com motivo) — só produtos SEM número de série.
--     Produto com número de série: transfira os seriais à mão (precisa bipar/conferir cada um).
do $$
declare
  r record;
  -- no SQL Editor não há usuário logado (auth.uid() é nulo): registra em nome do primeiro admin/CEO ativo
  v_actor uuid := coalesce(auth.uid(), (select id from public.employees where role in ('ceo', 'admin') and active order by created_at limit 1));
begin
  for r in
    select p.duplicado, p.principal, d.quantity, d.name as nome_dup, pr.name as nome_prin
      from plano_itens p join public.items d on d.id = p.duplicado join public.items pr on pr.id = p.principal
     where d.quantity > 0 and not d.track_serial and not pr.track_serial
  loop
    insert into public.movements (item_id, type, subtype, quantity, reason, adjustment_increases_stock, created_by)
    values (r.duplicado, 'ajuste', null, r.quantity, 'Limpeza de duplicado: saldo transferido para ' || r.nome_prin, false, v_actor);
    insert into public.movements (item_id, type, subtype, quantity, reason, adjustment_increases_stock, created_by)
    values (r.principal, 'ajuste', null, r.quantity, 'Limpeza de duplicado: saldo recebido de ' || r.nome_dup, true, v_actor);
  end loop;
end $$;

-- 3b) Desativa os duplicados/testes e libera o SKU/código (nada é apagado).
update public.items i
   set active = false,
       sku = case when i.sku is null then null else i.sku || '-DUP-' || left(i.id::text, 6) end,
       barcode = case when i.barcode is null then null else i.barcode || '-DUP-' || left(i.id::text, 6) end,
       updated_at = now()
 where i.id in (select duplicado from plano_itens);

-- 3c) Correções de nome/SKU (o trigger normaliza para CAIXA ALTA).
update public.items i
   set name = coalesce(c.novo_nome, i.name), sku = coalesce(c.novo_sku, i.sku), updated_at = now()
  from plano_correcoes c where c.id = i.id;

-- 3d) Funcionários: vincula a conta duplicada à principal e desativa a duplicada.
update public.employees e
   set merged_into = p.principal, active = false
  from plano_funcionarios p where p.duplicada = e.id;

-- 4) RESUMO — confira antes de trocar ROLLBACK por COMMIT --------------------------------------------------
select 'produtos desativados' as o_que, count(*) from public.items where id in (select duplicado from plano_itens)
union all select 'produtos corrigidos', count(*) from plano_correcoes
union all select 'contas vinculadas', count(*) from plano_funcionarios
union all select 'divergências de saldo restantes', count(*) from public.stock_integrity_report();

rollback;   -- ← troque por COMMIT quando o resumo estiver certo
