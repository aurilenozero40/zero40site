import { monthRange, todayParts } from "./dates";

/** "YYYY-MM" do mês atual NO FUSO DA LOJA (o servidor roda em UTC). */
export function currentMonthParam() {
  const { year, month } = todayParts();
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Limites do mês como instantes ISO (meia-noite de Brasília), prontos para .gte/.lt. */
export function getMonthRange(monthParam: string) {
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam) ? monthParam : currentMonthParam();
  const { from, to } = monthRange(valid);
  const [year, month] = valid.split("-").map(Number);
  return { start: from.toISOString(), end: to.toISOString(), year, month };
}

export function summarizeMovements<
  T extends { quantity: number; total_value: number | null; items: { name: string } | null }
>(rows: T[]) {
  const totalQuantity = rows.reduce((sum, r) => sum + r.quantity, 0);
  const totalValue = rows.reduce((sum, r) => sum + (r.total_value ?? 0), 0);

  const byItem = new Map<string, number>();
  for (const row of rows) {
    const name = row.items?.name ?? "-";
    byItem.set(name, (byItem.get(name) ?? 0) + row.quantity);
  }
  const topItem = Array.from(byItem.entries()).sort((a, b) => b[1] - a[1])[0];

  return {
    count: rows.length,
    totalQuantity,
    totalValue,
    topItemName: topItem?.[0] ?? null,
    topItemQuantity: topItem?.[1] ?? null,
  };
}

/** Agrupa por dia NO FUSO DA LOJA (e não por dia UTC). */
export function groupByDay<T extends { created_at: string; quantity: number; total_value: number | null }>(
  rows: T[]
) {
  const byDay = new Map<string, { day: string; quantity: number; value: number }>();
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });

  for (const row of rows) {
    const day = fmt.format(new Date(row.created_at)); // YYYY-MM-DD
    const existing = byDay.get(day) ?? { day, quantity: 0, value: 0 };
    existing.quantity += row.quantity;
    existing.value += row.total_value ?? 0;
    byDay.set(day, existing);
  }

  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}
