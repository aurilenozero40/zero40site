-- ============================================================================
-- 03 — DESFAZ a limpeza de 02-limpeza-reversivel.sql usando a foto em cleanup_backup.
-- Restaura nome, SKU, código de barras, ativo/inativo (produtos) e vínculo/ativo (funcionários).
-- NÃO desfaz os ajustes de saldo (o ledger é imutável): para devolver o saldo, lance uma entrada
-- em sentido contrário pela tela, com o motivo "reversão de limpeza".
-- ============================================================================
begin;

update public.items i
   set name = s.name, sku = s.sku, barcode = s.barcode, active = s.active, updated_at = now()
  from cleanup_backup.items_snapshot s
 where s.id = i.id
   and s.snapshot_at = (select max(x.snapshot_at) from cleanup_backup.items_snapshot x where x.id = s.id);

update public.employees e
   set merged_into = s.merged_into, active = s.active, full_name = s.full_name
  from cleanup_backup.employees_snapshot s
 where s.id = e.id
   and s.snapshot_at = (select max(x.snapshot_at) from cleanup_backup.employees_snapshot x where x.id = s.id);

select 'produtos restaurados' as o_que, count(distinct id) from cleanup_backup.items_snapshot
union all select 'funcionários restaurados', count(distinct id) from cleanup_backup.employees_snapshot;

rollback;   -- ← troque por COMMIT para confirmar o desfazer
