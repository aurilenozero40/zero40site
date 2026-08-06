"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Item } from "@/lib/types";
import { formatCurrency, formatQuantity } from "@/lib/utils";
import { LowStockBadge } from "./LowStockBadge";

export function ItemsTable({ items }: { items: Item[] }) {
  const [search, setSearch] = useState("");
  const [onlyLowStock, setOnlyLowStock] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const isLow = item.quantity < item.min_stock;
      if (onlyLowStock && !isLow) return false;
      if (!term) return true;
      return (
        item.name.toLowerCase().includes(term) ||
        item.sku?.toLowerCase().includes(term) ||
        item.category?.toLowerCase().includes(term)
      );
    });
  }, [items, search, onlyLowStock]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          className="input sm:max-w-xs"
          placeholder="Buscar por nome, SKU ou categoria..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={onlyLowStock}
            onChange={(e) => setOnlyLowStock(e.target.checked)}
          />
          Só estoque baixo
        </label>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Quantidade</th>
              <th className="px-4 py-3">Mínimo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => {
              const isLow = item.quantity < item.min_stock;
              return (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <Link href={`/itens/${item.id}`} className="hover:underline">
                      {item.name}
                    </Link>
                    {!item.active && (
                      <span className="ml-2 text-xs text-muted">(inativo)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted">{item.sku ?? "-"}</td>
                  <td className="px-4 py-3 text-muted">{item.category ?? "-"}</td>
                  <td className="px-4 py-3">{formatQuantity(item.quantity, item.unit)}</td>
                  <td className="px-4 py-3 text-muted">
                    {formatQuantity(item.min_stock, item.unit)}
                  </td>
                  <td className="px-4 py-3">{isLow && <LowStockBadge />}</td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Nenhum item encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {items.length > 0 && (
        <p className="text-xs text-muted">
          {formatCurrency(
            items.reduce((sum, i) => sum + (i.cost_price ?? 0) * i.quantity, 0)
          )}{" "}
          em custo de estoque (itens visíveis)
        </p>
      )}
    </div>
  );
}
