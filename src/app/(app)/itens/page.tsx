import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { ItemsTable } from "@/components/items/ItemsTable";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { escapeLike } from "@/lib/utils";
import type { ItemRow } from "@/components/items/ItemsTable";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

interface Params {
  q?: string;
  baixo?: string;
  inativos?: string;
  seminovos?: string;
  categoria?: string;
  pagina?: string;
}

export default async function ItensPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase, employee } = await requireEmployee();
  const params = await searchParams;
  const page = parsePage(params.pagina);
  const q = (params.q ?? "").trim().slice(0, 80);
  const onlyLow = params.baixo === "1";
  const showInactive = params.inativos === "1";
  const onlyUsed = params.seminovos === "1";
  const category = (params.categoria ?? "").trim();
  const manager = isManager(employee.role);

  // Categorias existentes pra popular o filtro (loja vende relógio, celular, acessório etc.).
  const { data: categoryRows } = await supabase.from("items").select("category").not("category", "is", null).order("category");
  const categories = [...new Set((categoryRows ?? []).map((r) => r.category as string).filter(Boolean))];

  let query = supabase.from("items").select("*, suppliers(id, name, is_placeholder)", { count: "exact" }).order("name");

  if (!showInactive) query = query.eq("active", true);
  if (onlyUsed) query = query.eq("condition", "seminovo");
  if (category) query = query.eq("category", category);

  if (q) {
    // vírgula, parênteses e aspas quebrariam a sintaxe do filtro `or`; % e _ viram texto literal
    const term = escapeLike(q.replace(/[(),\"]/g, " ").trim());
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%,category.ilike.%${term}%,manufacturer.ilike.%${term}%`);
  }

  // Regra única (baixo = abaixo do mínimo · esgotado = 0 · mínimo 0 nunca alerta) vive no banco:
  // filtro, selo da tabela, Dashboard e Reposição leem a mesma função.
  const { data: alerts } = await supabase.rpc("stock_alerts");
  const stockStatus = new Map<string, "baixo" | "esgotado">();
  for (const i of (alerts?.low ?? []) as { id: string }[]) stockStatus.set(i.id, "baixo");
  for (const i of (alerts?.out ?? []) as { id: string }[]) stockStatus.set(i.id, "esgotado");

  if (onlyLow) {
    const ids = [...stockStatus.keys()];
    query = ids.length > 0 ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { data: items, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error)
    console.error(
      `[itens] erro ao buscar items: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
    );

  // % de participação nas vendas e classificação ABC (curva de Pareto) — só gerente+.
  const salesShare = new Map<string, number>();
  const abcClass = new Map<string, "A" | "B" | "C">();
  if (manager) {
    const { data: ranking } = await supabase.rpc("item_sales_ranking");
    const rows = (ranking as { item_id: string; share_percent: number }[]) ?? [];
    let cumulative = 0;
    for (const r of rows) {
      salesShare.set(r.item_id, r.share_percent);
      cumulative += r.share_percent;
      // A = primeiros 80% do faturamento · B = até 95% · C = o resto (cauda longa).
      abcClass.set(r.item_id, cumulative <= 80 ? "A" : cumulative <= 95 ? "B" : "C");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Produtos</h1>
        {manager && (
          <div className="flex gap-2">
            <Link href="/itens/kits" className="btn-secondary">
              Kits e combos
            </Link>
            <Link href="/itens/novo" className="btn-primary">
              <Plus size={16} />
              Novo produto
            </Link>
          </div>
        )}
      </div>

      <form method="get" className="card flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={q} className="input pl-9" placeholder="Nome, SKU, código de barras, categoria, marca..." />
          </div>
          {categories.length > 0 && (
            <select name="categoria" defaultValue={category} className="input sm:w-48">
              <option value="">Todas as categorias</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <button type="submit" className="btn-secondary shrink-0">
            Filtrar
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-sm text-foreground">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="baixo" value="1" defaultChecked={onlyLow} /> Estoque baixo / esgotado
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="seminovos" value="1" defaultChecked={onlyUsed} /> Só seminovos
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="inativos" value="1" defaultChecked={showInactive} /> Mostrar inativos
          </label>
        </div>
      </form>

      <ItemsTable items={(items as ItemRow[]) ?? []} stockStatus={stockStatus} showCost={manager} salesShare={manager ? salesShare : undefined} abcClass={manager ? abcClass : undefined} />
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        basePath="/itens"
        params={{
          q: q || undefined,
          baixo: onlyLow ? "1" : undefined,
          seminovos: onlyUsed ? "1" : undefined,
          categoria: category || undefined,
          inativos: showInactive ? "1" : undefined,
        }}
      />
    </div>
  );
}
