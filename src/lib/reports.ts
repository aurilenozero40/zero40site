export function currentMonthParam() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function getMonthRange(monthParam: string) {
  const [yearStr, monthStr] = monthParam.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr); // 1-12

  const start = `${yearStr}-${monthStr}-01`;
  const endDate = new Date(year, month, 1); // primeiro dia do mês seguinte
  const end = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, "0")}-01`;

  return { start, end, year, month };
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

export function groupByDay<T extends { created_at: string; quantity: number; total_value: number | null }>(
  rows: T[]
) {
  const byDay = new Map<string, { day: string; quantity: number; value: number }>();

  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    const existing = byDay.get(day) ?? { day, quantity: 0, value: 0 };
    existing.quantity += row.quantity;
    existing.value += row.total_value ?? 0;
    byDay.set(day, existing);
  }

  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}
