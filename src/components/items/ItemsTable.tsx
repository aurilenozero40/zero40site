import Link from "next/link";
import type { Item } from "@/lib/types";
import { formatCurrency, formatQuantity } from "@/lib/utils";
import { LowStockBadge } from "./LowStockBadge";

/** Estoque baixo: mínimo definido e saldo <= mínimo (mesma regra do banco). */
export const isLowStock = (item: Pick<Item, "quantity" | "min_stock">) => item.min_stock > 0 && item.quantity <= item.min_stock;

export function ItemsTable({ items, showCost }: { items: Item[]; showCost: boolean }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-3">Nome</th>
            <th className="px-4 py-3">SKU</th>
            <th className="px-4 py-3">Cód. barras</th>
            <th className="px-4 py-3 text-right">Preço</th>
            {showCost && <th className="px-4 py-3 text-right">Custo</th>}
            <th className="px-4 py-3 text-right">Estoque</th>
            <th className="px-4 py-3 text-right">Mínimo</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const low = isLowStock(item);
            return (
              <tr key={item.id} className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.04]">
                <td className="px-4 py-3 font-medium text-foreground">
                  <Link href={`/itens/${item.id}`} className="hover:underline">
                    {item.name}
                  </Link>
                  {!item.active && <span className="ml-2 text-xs font-normal text-muted">(inativo)</span>}
                </td>
                <td className="px-4 py-3 text-muted">{item.sku ?? "-"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{item.barcode ?? "-"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{item.sale_price === null ? <span className="text-muted">—</span> : formatCurrency(item.sale_price)}</td>
                {showCost && <td className="px-4 py-3 text-right tabular-nums text-muted">{item.cost_price === null ? "—" : formatCurrency(item.cost_price)}</td>}
                <td className={`px-4 py-3 text-right tabular-nums ${item.quantity <= 0 ? "text-danger" : ""}`}>{formatQuantity(item.quantity, item.unit)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted">{formatQuantity(item.min_stock, item.unit)}</td>
                <td className="px-4 py-3">{low && <LowStockBadge />}</td>
              </tr>
            );
          })}
          {items.length === 0 && (
            <tr>
              <td colSpan={showCost ? 8 : 7} className="px-4 py-8 text-center text-muted">
                Nenhum item encontrado.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
