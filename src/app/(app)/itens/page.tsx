import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { ItemsTable } from "@/components/items/ItemsTable";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { escapeLike } from "@/lib/utils";
import type { Item } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

interface Params {
  q?: string;
  baixo?: string;
  inativos?: string;
  seminovos?: string;
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
  const manager = isManager(employee.role);

  let query = supabase.from("items").select("*", { count: "exact" }).order("name");

  if (!showInactive) query = query.eq("active", true);
  if (onlyUsed) query = query.eq("condition", "seminovo");

  if (q) {
    // vírgula, parênteses e aspas quebrariam a sintaxe do filtro `or`; % e _ viram texto literal
    const term = escapeLike(q.replace(/[(),\"]/g, " ").trim());
    query = query.or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%,category.ilike.%${term}%,manufacturer.ilike.%${term}%`);
  }

  if (onlyLow) {
    // coluna vs coluna (quantity <= min_stock) não existe no filtro da API: usa a regra do banco
    const { data: alerts } = await supabase.rpc("stock_alerts");
    const ids = [...(alerts?.low ?? []), ...(alerts?.out ?? [])].map((i: { id: string }) => i.id);
    query = ids.length > 0 ? query.in("id", ids) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { data: items, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error)
    console.error(
      `[itens] erro ao buscar items: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
    );

  // % de participação nas vendas — só gerente+ (o próprio banco só devolveria as vendas do vendedor).
  const salesShare = new Map<string, number>();
  if (manager) {
    const { data: ranking } = await supabase.rpc("item_sales_ranking");
    for (const r of (ranking as { item_id: string; share_percent: number }[]) ?? []) salesShare.set(r.item_id, r.share_percent);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Produtos</h1>
        {manager && (
          <Link href="/itens/novo" className="btn-primary">
            <Plus size={16} />
            Novo produto
          </Link>
        )}
      </div>

      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-sm sm:flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} className="input pl-9" placeholder="Nome, SKU, código de barras, categoria, marca..." />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="baixo" value="1" defaultChecked={onlyLow} /> Estoque baixo / esgotado
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="seminovos" value="1" defaultChecked={onlyUsed} /> Só seminovos
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="inativos" value="1" defaultChecked={showInactive} /> Mostrar inativos
        </label>
        <button type="submit" className="btn-secondary">
          Filtrar
        </button>
      </form>

      <ItemsTable items={(items as Item[]) ?? []} showCost={manager} salesShare={manager ? salesShare : undefined} />
      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        basePath="/itens"
        params={{
          q: q || undefined,
          baixo: onlyLow ? "1" : undefined,
          seminovos: onlyUsed ? "1" : undefined,
          inativos: showInactive ? "1" : undefined,
        }}
      />
    </div>
  );
}
