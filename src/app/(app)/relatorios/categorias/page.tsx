import { requireManager } from "@/lib/auth/session";
import { formatCurrency, formatQuantity } from "@/lib/utils";
import type { ItemSalesRankingRow } from "@/lib/types";

export const dynamic = "force-dynamic";

interface Group {
  key: string;
  units: number;
  revenue: number;
}

function groupBy(rows: ItemSalesRankingRow[], pick: (r: ItemSalesRankingRow) => string | null) {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = pick(r) ?? "Sem categoria";
    const g = map.get(key) ?? { key, units: 0, revenue: 0 };
    g.units += Number(r.units_sold);
    g.revenue += Number(r.revenue);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

/** Quanto cada categoria e marca representa do faturamento — pra ver onde o mix de vendas está. */
export default async function RelatorioCategoriasPage() {
  const { supabase } = await requireManager();
  const { data, error } = await supabase.rpc("item_sales_ranking");

  if (error) console.error(`[relatorios/categorias] erro: code=${error.code} message=${error.message}`);
  const rows = (data as ItemSalesRankingRow[]) ?? [];
  const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
  const byCategory = groupBy(rows, (r) => r.category);
  const byBrand = groupBy(rows, (r) => r.manufacturer);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Vendas por categoria e marca</h1>
        <p className="text-sm text-muted">Faturamento histórico (todas as vendas concluídas) agrupado por categoria e por fabricante/marca.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable title="Por categoria" groups={byCategory} total={total} />
        <GroupTable title="Por marca" groups={byBrand} total={total} />
      </div>
    </div>
  );
}

function GroupTable({ title, groups, total }: { title: string; groups: Group[]; total: number }) {
  return (
    <div className="card flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {groups.length === 0 ? (
        <p className="text-sm text-muted">Sem vendas registradas ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {groups.map((g) => {
            const share = total > 0 ? (g.revenue / total) * 100 : 0;
            return (
              <li key={g.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-foreground">{g.key}</span>
                  <span className="tabular-nums text-muted">
                    {formatCurrency(g.revenue)} · {formatQuantity(g.units)} un · {share.toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background">
                  <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-alt" style={{ width: `${share}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
