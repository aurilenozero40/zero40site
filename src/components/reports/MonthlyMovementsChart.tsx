"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCurrency } from "@/lib/utils";

export function MonthlyMovementsChart({
  data,
}: {
  data: { day: string; quantity: number; value: number }[];
}) {
  if (data.length === 0) {
    return (
      <div className="card flex h-64 items-center justify-center text-sm text-muted">
        Sem movimentações no período selecionado.
      </div>
    );
  }

  return (
    <div className="card h-72 p-4">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => d.slice(8, 10)}
            fontSize={12}
            stroke="var(--color-muted)"
          />
          <YAxis fontSize={12} stroke="var(--color-muted)" />
          <Tooltip
            formatter={(value, name) =>
              name === "value" ? formatCurrency(Number(value)) : value
            }
          />
          <Bar dataKey="value" name="Valor" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
