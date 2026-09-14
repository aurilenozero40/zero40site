import { createClient } from "@/lib/supabase/server";
import { MonthPicker } from "@/components/reports/MonthPicker";
import { MonthlyMovementsChart } from "@/components/reports/MonthlyMovementsChart";
import { ExportCsvButton } from "@/components/reports/ExportCsvButton";
import { MovementsTable } from "@/components/movements/MovementsTable";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { currentMonthParam, getMonthRange, groupByDay, summarizeMovements } from "@/lib/reports";
import { formatCurrency, formatQuantity } from "@/lib/utils";
import type { MovementWithRelations } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RelatorioEntradasPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthParam } = await searchParams;
  const month = monthParam ?? currentMonthParam();
  const { start, end } = getMonthRange(month);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("movements")
    .select("*, items(id, name, sku, unit), employees(id, full_name)")
    .eq("type", "entrada")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false });

  if (error)
    console.error(
      `[relatorios/entradas] erro ao buscar movements: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
    );

  const movements = (data as MovementWithRelations[]) ?? [];
  const summary = summarizeMovements(movements);
  const chartData = groupByDay(movements);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Relatório de entradas</h1>
        <div className="flex items-center gap-3">
          <MonthPicker month={month} />
          <ExportCsvButton movements={movements} filename={`entradas-${month}.csv`} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard label="Movimentações" value={String(summary.count)} />
        <KpiCard label="Quantidade total" value={formatQuantity(summary.totalQuantity)} />
        <KpiCard label="Valor total" value={formatCurrency(summary.totalValue)} />
        <KpiCard
          label="Item mais movimentado"
          value={summary.topItemName ?? "-"}
          hint={summary.topItemQuantity ? formatQuantity(summary.topItemQuantity) : undefined}
        />
      </div>

      <MonthlyMovementsChart data={chartData} />
      <MovementsTable movements={movements} />
    </div>
  );
}
