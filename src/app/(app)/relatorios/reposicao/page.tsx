import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { formatQuantity } from "@/lib/utils";
import type { Item, Supplier } from "@/lib/types";

export const dynamic = "force-dynamic";

type ItemWithSupplier = Item & { suppliers: Pick<Supplier, "id" | "name"> | null };

/** O que já está baixo/esgotado, agrupado por fornecedor — pra saber pra quem ligar e repor. */
export default async function RelatorioReposicaoPage() {
  const { supabase } = await requireManager();

  // "Precisa repor": esgotado, ou com mínimo definido e saldo <= mínimo — coluna vs coluna não
  // existe no filtro da API, então usa a mesma regra do banco que /itens já usa (stock_alerts).
  const { data: alerts } = await supabase.rpc("stock_alerts");
  const ids = [...(alerts?.low ?? []), ...(alerts?.out ?? [])].map((i: { id: string }) => i.id);

  const { data, error } =
    ids.length > 0
      ? await supabase.from("items").select("*, suppliers(id, name)").in("id", ids).order("name")
      : { data: [] as ItemWithSupplier[], error: null };

  if (error) console.error(`[relatorios/reposicao] erro: code=${error.code} message=${error.message}`);
  const items = (data as unknown as ItemWithSupplier[]) ?? [];

  const groups = new Map<string, { supplier: string; items: ItemWithSupplier[] }>();
  for (const i of items) {
    const key = i.suppliers?.id ?? "sem-fornecedor";
    const g = groups.get(key) ?? { supplier: i.suppliers?.name ?? "Sem fornecedor definido", items: [] };
    g.items.push(i);
    groups.set(key, g);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => b.items.length - a.items.length);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Sugestão de compra</h1>
        <p className="text-sm text-muted">Produtos esgotados ou abaixo do mínimo, agrupados por fornecedor — pra facilitar o pedido.</p>
      </div>

      {sortedGroups.length === 0 ? (
        <div className="card text-sm text-muted">Nenhum produto precisando de reposição agora. 🎉</div>
      ) : (
        sortedGroups.map((g) => (
          <div key={g.supplier} className="card flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">{g.supplier}</h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2">Produto</th>
                  <th className="py-2 text-right">Estoque</th>
                  <th className="py-2 text-right">Mínimo</th>
                  <th className="py-2 text-right">Sugestão</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map((i) => {
                  const target = Math.max(Number(i.min_stock), Number(i.reorder_point ?? 0));
                  const suggestion = Math.max(target - Number(i.quantity), 0);
                  return (
                    <tr key={i.id} className="border-b border-border last:border-0">
                      <td className="py-2">
                        <Link href={`/itens/${i.id}`} className="font-medium text-foreground hover:underline">
                          {i.name}
                        </Link>
                      </td>
                      <td className={`py-2 text-right tabular-nums ${i.quantity <= 0 ? "text-danger" : "text-warning"}`}>
                        {formatQuantity(i.quantity, i.unit)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted">{formatQuantity(i.min_stock, i.unit)}</td>
                      <td className="py-2 text-right tabular-nums font-medium text-foreground">
                        {suggestion > 0 ? formatQuantity(suggestion, i.unit) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
