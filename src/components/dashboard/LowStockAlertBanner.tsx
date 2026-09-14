"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast-context";
import { formatQuantity } from "@/lib/utils";

type LowStockItem = {
  id: string;
  name: string;
  quantity: number;
  min_stock: number;
  unit: string;
};

export function LowStockAlertBanner() {
  const [lowItems, setLowItems] = useState<LowStockItem[] | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const supabase = createClient();
    let active = true;

    async function loadInitial() {
      const { data } = await supabase
        .from("items")
        .select("id, name, quantity, min_stock, unit")
        .eq("active", true)
        .order("name");

      if (!active || !data) return;
      setLowItems(data.filter((i) => i.quantity < i.min_stock));
    }

    loadInitial();

    const channel = supabase
      .channel("items-low-stock")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "items" },
        (payload) => {
          const item = payload.new as LowStockItem & { active: boolean };
          const old = payload.old as LowStockItem;
          const isLow = item.active && item.quantity < item.min_stock;
          const wasLow = old.quantity < old.min_stock;

          setLowItems((prev) => {
            const current = prev ?? [];
            const withoutItem = current.filter((i) => i.id !== item.id);
            return isLow
              ? [...withoutItem, item].sort((a, b) => a.name.localeCompare(b.name))
              : withoutItem;
          });

          if (isLow && !wasLow) {
            toast({
              title: "Estoque baixo",
              description: `${item.name} está abaixo do mínimo (${formatQuantity(item.quantity, item.unit)})`,
              variant: "destructive",
            });
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "items" },
        (payload) => {
          const item = payload.new as LowStockItem & { active: boolean };
          if (item.active && item.quantity < item.min_stock) {
            setLowItems((prev) => [...(prev ?? []), item].sort((a, b) => a.name.localeCompare(b.name)));
          }
        }
      )
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
        Nenhum item abaixo do estoque mínimo.
      </div>
    );
  }

  return (
    <div className="card border-danger/30 bg-danger/5">
      <div className="flex items-center gap-2.5 text-sm font-semibold text-danger">
        <AlertTriangle size={18} />
        {lowItems.length} {lowItems.length === 1 ? "item abaixo" : "itens abaixo"} do estoque mínimo
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-danger/10">
        {lowItems.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-1.5 text-sm first:pt-0 last:pb-0">
            <Link href={`/itens/${item.id}`} className="font-medium text-foreground hover:underline">
              {item.name}
            </Link>
            <span className="tabular-nums text-muted">
              {formatQuantity(item.quantity, item.unit)} / mín. {formatQuantity(item.min_stock, item.unit)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
