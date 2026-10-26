-- ============================================================================
-- 01 — AUDITORIA (SOMENTE LEITURA). Nada aqui altera dados.
-- Rode no SQL Editor do Supabase, bloco por bloco, e me mostre o resultado ANTES de qualquer limpeza.
-- ============================================================================

-- A) Produtos com o MESMO nome (ignorando caixa/espaços) — candidatos a duplicado.
select upper(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')) as nome_normalizado,
       count(*) as qtd,
       jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'barcode', barcode, 'estoque', quantity, 'ativo', active, 'vendas', (select count(*) from sale_items si where si.item_id = i.id)) order by created_at) as itens
  from items i
 group by 1
having count(*) > 1
 order by 1;

-- B) Quase-duplicados: nomes que só diferem em 1-2 letras (GARMIN FENIX 8 PRO PRETA x PRETO, GARMINN x GARMIN...).
--    (precisa da extensão pg_trgm: create extension if not exists pg_trgm;)
select a.id as id_a, a.name as nome_a, a.sku as sku_a, a.quantity as estoque_a,
       b.id as id_b, b.name as nome_b, b.sku as sku_b, b.quantity as estoque_b,
       round(similarity(upper(a.name), upper(b.name))::numeric, 2) as similaridade
  from items a
  join items b on a.id < b.id and similarity(upper(a.name), upper(b.name)) > 0.8
 order by similaridade desc, a.name;

-- C) SKU / código de barras repetidos (normalizados) — impedem o índice único de ser criado.
select 'sku' as campo, upper(btrim(sku)) as valor, count(*) as qtd, array_agg(name order by name) as produtos
  from items where sku is not null and btrim(sku) <> '' group by 2 having count(*) > 1
union all
select 'barcode', lower(btrim(barcode)), count(*), array_agg(name order by name)
  from items where barcode is not null and btrim(barcode) <> '' group by 2 having count(*) > 1;

-- D) Produtos sem SKU e/ou sem código de barras (não são lidos pela entrada por código de barras).
select id, name, sku, barcode, quantity, active
  from items
 where (sku is null or btrim(sku) = '') or (barcode is null or btrim(barcode) = '')
 order by (sku is null), name;

-- E) Suspeitos de teste/lixo: SKU curto ('xx'), nome com minúsculas, sem preço e sem movimento, etc.
select i.id, i.name, i.sku, i.barcode, i.quantity, i.active,
       (select count(*) from sale_items si where si.item_id = i.id) as vendas,
       (select count(*) from movements m where m.item_id = i.id) as movimentacoes
  from items i
 where length(btrim(coalesce(i.sku, ''))) between 1 and 2
    or i.name <> upper(i.name)
    or i.name ~* '(teste|test|xxx|esportivo$)'
 order by i.name;

-- F) Possíveis erros de digitação conhecidos (confirme um a um antes de corrigir).
select id, name, sku from items
 where name ~* '(GARMINN|PRETOO|MARFIN|ROSEO)' or sku ~ '[a-z]'
 order by name;

-- G) Fornecedor "INVENTARIO" e onde ele é usado (não pode ser escolha em compra nova).
select s.id, s.name, s.is_placeholder,
       (select count(*) from items i where i.supplier_id = s.id) as produtos,
       (select count(*) from movements m where m.supplier_id = s.id) as movimentacoes
  from suppliers s order by s.name;

-- H) Funcionários duplicados / com e-mail no lugar do nome e quantas vendas cada conta tem.
select e.id, e.full_name, e.role, e.active, e.merged_into,
       (select count(*) from sales s where s.seller_id = e.id) as vendas,
       au.email
  from employees e
  left join auth.users au on au.id = e.id
 order by lower(split_part(coalesce(au.email, e.full_name), '@', 1)), e.full_name;

-- I) INTEGRIDADE DE SALDO: saldo do produto x soma das movimentações (e seriais).  Vazio = tudo certo.
--    (rode logado como gerente+, ou use o SQL abaixo direto como superusuário)
with led as (
  select item_id, sum(case type when 'entrada' then quantity when 'saida' then -quantity
                                else case when adjustment_increases_stock then quantity else -quantity end end) as q
    from movements group by item_id
), ser as (
  select item_id, count(*) filter (where status = 'estoque') as n from item_serials group by item_id
)
select i.id, i.name, i.sku, i.quantity as saldo, coalesce(l.q, 0) as soma_movimentacoes, coalesce(s.n, 0) as seriais_em_estoque
  from items i left join led l on l.item_id = i.id left join ser s on s.item_id = i.id
 where i.quantity <> coalesce(l.q, 0) or (i.track_serial and i.quantity <> coalesce(s.n, 0))
 order by i.name;

-- J) FATURAMENTO DO MÊS por SQL independente (fuso America/Fortaleza). Compare com o Dashboard.
--    Troque o mês se precisar.
select coalesce(sum(total - refunded_amount), 0) as faturamento_liquido,
       count(*) filter (where status <> 'devolvida') as vendas,
       coalesce(sum(total), 0) as bruto, coalesce(sum(refunded_amount), 0) as devolvido
  from sales
 where status in ('concluida', 'parcialmente_devolvida', 'devolvida')
   and (created_at at time zone 'America/Fortaleza')::date >= date_trunc('month', (now() at time zone 'America/Fortaleza'))::date
   and (created_at at time zone 'America/Fortaleza')::date <  (date_trunc('month', (now() at time zone 'America/Fortaleza')) + interval '1 month')::date;

-- K) Vendas de ontem à noite que cairiam no dia errado se o fuso fosse UTC (conferência de fuso).
select number, created_at, (created_at at time zone 'UTC')::date as dia_utc, (created_at at time zone 'America/Fortaleza')::date as dia_fortaleza
  from sales
 where (created_at at time zone 'UTC')::date <> (created_at at time zone 'America/Fortaleza')::date
 order by created_at desc limit 50;
