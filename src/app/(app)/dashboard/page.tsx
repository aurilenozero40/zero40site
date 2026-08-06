import { createClient } from "@/lib/supabase/server";
import { LowStockAlertBanner } from "@/components/dashboard/LowStockAlertBanner";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { MovementsTable } from "@/components/movements/MovementsTable";
import { currentMonthParam, getMonthRange } from "@/lib/reports";
import { formatCurrency } from "@/lib/utils";
import type { MovementWithRelations } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { start, end } = getMonthRange(currentMonthParam());

  const [{ data: items }, { count: movementsThisMonth }, { data: recentMovements }] =
    await Promise.all([
      supabase.from("items").select("quantity, cost_price").eq("active", true),
      supabase
        .from("movements")
        .select("*", { count: "exact", head: true })
        .gte("created_at", start)
        .lt("created_at", end),
      supabase
        .from("movements")
        .select("*, items(id, name, sku, unit), employees(id, full_name)")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const totalItems = items?.length ?? 0;
  const stockValue = (items ?? []).reduce(
    (sum, i) => sum + (i.cost_price ?? 0) * i.quantity,
    0
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>

      <LowStockAlertBanner />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <KpiCard label="Itens ativos" value={String(totalItems)} />
        <KpiCard label="Valor em estoque" value={formatCurrency(stockValue)} />
        <KpiCard label="Movimentações no mês" value={String(movementsThisMonth ?? 0)} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Últimas movimentações</h2>
        <MovementsTable movements={(recentMovements as MovementWithRelations[]) ?? []} />
      </div>
    </div>
  );
}
