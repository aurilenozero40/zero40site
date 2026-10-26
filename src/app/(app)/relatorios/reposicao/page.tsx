import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { formatQuantity } from "@/lib/utils";
import type { StockAlertRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_SUPPLIER = "sem-fornecedor";

/**
 * O que precisa de reposição, agrupado pelo ÚLTIMO fornecedor real de compra de cada produto.
 * Lista, sugestão e fornecedor vêm de stock_alert_rows() — a mesma regra do Dashboard e de
 * Produtos. Sugestão = quanto falta para o mínimo (mínimo − saldo), sempre pelo menos 1.
 */
export default async function RelatorioReposicaoPage() {
  const { supabase } = await requireManager();

  const { data, error } = await supabase.rpc("stock_alert_rows");
  if (error) console.error(`[relatorios/reposicao] erro: code=${error.code} message=${error.message}`);
  const rows = ((data as StockAlertRow[] | null) ?? []).map((r) => ({
    ...r,
    quantity: Number(r.quantity),
    min_stock: Number(r.min_stock),
    suggestion: Number(r.suggestion),
  }));

  const groups = new Map<string, { supplier: string; items: StockAlertRow[] }>();
  for (const r of rows) {
    const key = r.supplier_id ?? NO_SUPPLIER;
    const g = groups.get(key) ?? { supplier: r.supplier_name ?? "Sem fornecedor (nenhuma compra registrada)", items: [] };
    g.items.push(r);
    groups.set(key, g);
  }
  for (const g of groups.values()) g.items.sort((a, b) => a.name.localeCompare(b.name));
  // "sem fornecedor" por último; o resto, do grupo maior para o menor
  const sortedGroups = [...groups.entries()].sort(([ka, a], [kb, b]) => (ka === NO_SUPPLIER ? 1 : kb === NO_SUPPLIER ? -1 : b.items.length - a.items.length)).map(([, g]) => g);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Sugestão de compra</h1>
        <p className="text-sm text-muted">
          Produtos esgotados (saldo 0) ou abaixo do mínimo, agrupados pelo último fornecedor de compra. <strong>Sugestão = estoque mínimo − saldo atual</strong> (no mínimo 1 un.). Produto com mínimo 0 não entra.
        </p>
      </div>

      {error && <div className="card border-danger/30 bg-danger/5 text-sm text-danger">Não foi possível carregar a reposição. Atualize a página.</div>}

      {!error && sortedGroups.length === 0 ? (
        <div className="card text-sm text-muted">Nenhum produto precisando de reposição agora. 🎉</div>
      ) : (
        sortedGroups.map((g) => (
          <div key={g.supplier} className="card flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-foreground">
              {g.supplier} <span className="font-normal text-muted">· {g.items.length}</span>
            </h2>
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
                {g.items.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="py-2">
                      <Link href={`/itens/${i.id}`} className="font-medium text-foreground hover:underline">
                        {i.name}
                      </Link>
                      {i.status === "esgotado" && <span className="ml-2 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger">Esgotado</span>}
                    </td>
                    <td className={`py-2 text-right tabular-nums ${i.quantity <= 0 ? "text-danger" : "text-warning"}`}>{formatQuantity(i.quantity, i.unit)}</td>
                    <td className="py-2 text-right tabular-nums text-muted">{formatQuantity(i.min_stock, i.unit)}</td>
                    <td className="py-2 text-right tabular-nums font-medium text-foreground">{formatQuantity(i.suggestion, i.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
