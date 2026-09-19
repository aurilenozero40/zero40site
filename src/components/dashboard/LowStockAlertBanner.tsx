"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast-context";
import { formatQuantity } from "@/lib/utils";
import type { StockAlerts } from "@/lib/types";

type LowStockItem = StockAlerts["low"][number];

/** Estoque baixo = mínimo definido e saldo <= mínimo (mesma regra do banco e do Telegram). */
const isLow = (i: { active?: boolean; quantity: number; min_stock: number }) =>
  i.active !== false && Number(i.min_stock) > 0 && Number(i.quantity) > 0 && Number(i.quantity) <= Number(i.min_stock);

export function LowStockAlertBanner() {
  const [lowItems, setLowItems] = useState<LowStockItem[] | null>(null);
  const known = useRef<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function loadInitial() {
      // O banco já devolve só o que está baixo (nada de baixar todos os produtos).
      const { data } = await supabase.rpc("stock_alerts");
      if (!active || !data) return;
      const low = (data as StockAlerts).low;
      known.current = new Set(low.map((i) => i.id));
      setLowItems(low);
    }

    loadInitial();

    const channel = supabase
      .channel("items-low-stock")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "items" }, (payload) => {
        const item = payload.new as LowStockItem & { active: boolean };
        const nowLow = isLow(item);
        const wasLow = known.current.has(item.id);

        setLowItems((prev) => {
          const withoutItem = (prev ?? []).filter((i) => i.id !== item.id);
          return nowLow ? [...withoutItem, item].sort((a, b) => a.name.localeCompare(b.name)) : withoutItem;
        });
        if (nowLow) known.current.add(item.id);
        else known.current.delete(item.id);

        // avisa só na virada (não a cada movimentação enquanto continua baixo)
        if (nowLow && !wasLow) {
          toast({
            title: "Estoque baixo",
            description: `${item.name} está no mínimo (${formatQuantity(Number(item.quantity), item.unit)})`,
            variant: "destructive",
          });
        }
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [toast]);

  if (lowItems === null) return null;

  if (lowItems.length === 0) {
    return (
      <div className="card flex items-center gap-2.5 border-success/30 bg-success/5 text-sm text-success">
        <CheckCircle2 size={18} />
        Nenhum item com estoque baixo.
      </div>
    );
  }

  return (
    <div className="card border-danger/30 bg-danger/5">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-danger">
        <AlertTriangle size={18} />
        {lowItems.length} {lowItems.length === 1 ? "item com estoque baixo" : "itens com estoque baixo"}
      </div>
      <ul className="mt-3 flex max-h-56 flex-col divide-y divide-danger/10 overflow-y-auto">
        {lowItems.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-1.5 text-sm first:pt-0 last:pb-0">
            <Link href={`/itens/${item.id}`} className="font-medium text-foreground hover:underline">
              {item.name}
            </Link>
            <span className="tabular-nums text-muted">
              {formatQuantity(Number(item.quantity), item.unit)} / mín. {formatQuantity(Number(item.min_stock), item.unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
