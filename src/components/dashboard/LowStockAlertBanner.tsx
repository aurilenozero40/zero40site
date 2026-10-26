"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast-context";
import { formatQuantity } from "@/lib/utils";
import type { StockAlerts } from "@/lib/types";

type LowStockItem = StockAlerts["low"][number];

export function LowStockAlertBanner() {
  const [lowItems, setLowItems] = useState<LowStockItem[] | null>(null);
  const known = useRef<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    // A regra (abaixo do mínimo, mínimo 0 nunca alerta…) mora SÓ no banco: a tela pergunta de novo
    // a cada mudança de produto em vez de recalcular por conta própria.
    async function load(notify: boolean) {
      const { data } = await supabase.rpc("stock_alerts");
      if (!active || !data) return;
      const low = (data as StockAlerts).low;
      if (notify) {
        // avisa só na virada (não a cada movimentação enquanto continua baixo)
        for (const item of low) {
          if (!known.current.has(item.id)) {
            toast({
              title: "Estoque baixo",
              description: `${item.name}: ${formatQuantity(Number(item.quantity), item.unit)} (mínimo ${formatQuantity(Number(item.min_stock), item.unit)})`,
              variant: "destructive",
            });
          }
        }
      }
      known.current = new Set(low.map((i) => i.id));
      setLowItems(low);
    }

    void load(false);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("items-low-stock")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "items" }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => void load(true), 400);
      })
      .subscribe();

    return () => {
      active = false;
      clearTimeout(timer);
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
              {formatQuantity(Number(item.quantity), item.unit)} / mín. {formatQuantity(Number(item.min_stock), item.unit)} · comprar {formatQuantity(Number(item.suggestion), item.unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
