import Link from "next/link";
import { Package, Wallet, ArrowLeftRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { LowStockAlertBanner } from "@/components/dashboard/LowStockAlertBanner";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { MovementsTable } from "@/components/movements/MovementsTable";
import { currentMonthParam, getMonthRange } from "@/lib/reports";
import { formatCurrency } from "@/lib/utils";
import type { MovementWithRelations } from "@/lib/types";

// Sempre busca dado fresco — página autenticada e cheia de dado que muda a
// cada movimentação, cache de fetch do Next só atrapalha aqui.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { start, end } = getMonthRange(currentMonthParam());

  const [
    { data: items, error: itemsError },
    { count: movementsThisMonth, error: countError },
    { data: recentMovements, error: movementsError },
  ] = await Promise.all([
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

  if (itemsError)
    console.error(
      `[dashboard] erro ao buscar items: code=${itemsError.code} message=${itemsError.message} details=${itemsError.details} hint=${itemsError.hint}`
    );
  if (countError)
    console.error(
      `[dashboard] erro ao contar movements do mês: code=${countError.code} message=${countError.message} details=${countError.details} hint=${countError.hint}`
    );
  if (movementsError)
    console.error(
      `[dashboard] erro ao buscar recentMovements: code=${movementsError.code} message=${movementsError.message} details=${movementsError.details} hint=${movementsError.hint}`
    );

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
        <KpiCard label="Itens ativos" value={String(totalItems)} icon={Package} />
        <KpiCard label="Valor em estoque" value={formatCurrency(stockValue)} icon={Wallet} />
        <KpiCard
          label="Movimentações no mês"
          value={String(movementsThisMonth ?? 0)}
          icon={ArrowLeftRight}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Últimas movimentações</h2>
          <Link href="/movimentacoes" className="text-xs font-medium text-accent hover:underline">
            Ver todas
          </Link>
        </div>
        <MovementsTable movements={(recentMovements as MovementWithRelations[]) ?? []} />
      </div>
    </div>
  );
}
