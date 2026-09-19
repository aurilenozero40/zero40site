"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/utils";

export function RevenueChart({ data }: { data: { day: string; revenue: number; sales: number }[] }) {
  if (data.length === 0) {
    return <div className="flex h-56 items-center justify-center text-sm text-muted">Sem vendas no período selecionado.</div>;
  }

  const points = data.map((d) => ({ ...d, label: `${d.day.slice(8, 10)}/${d.day.slice(5, 7)}` }));

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis dataKey="label" fontSize={12} stroke="var(--color-muted)" tickLine={false} />
          <YAxis
            fontSize={12}
            stroke="var(--color-muted)"
            tickLine={false}
            axisLine={false}
            width={60}
            tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k` : String(v))}
          />
          <Tooltip
            cursor={{ fill: "var(--color-border)", opacity: 0.3 }}
            contentStyle={{ background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: "var(--color-muted)" }}
            formatter={(value, name) => (name === "revenue" ? [formatCurrency(Number(value)), "Faturamento"] : [String(value), "Vendas"])}
          />
          <Bar dataKey="revenue" name="revenue" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
