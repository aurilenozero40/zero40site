import { requireManager } from "@/lib/auth/session";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { resolvePeriod, todayParts } from "@/lib/dates";
import { PAYMENT_LABEL, type PaymentMethod } from "@/lib/sales/pricing";
import { formatCurrency, formatQuantity } from "@/lib/utils";
import type { SaleDashboard } from "@/lib/types";

export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
const todayIso = () => {
  const t = todayParts();
  return `${t.year}-${pad(t.month)}-${pad(t.day)}`;
};

/** Fechamento de caixa do dia: quanto entrou, em cada forma de pagamento, e por vendedor. */
export default async function RelatorioCaixaPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const { supabase } = await requireManager();
  const { data: dataParam } = await searchParams;
  const date = dataParam ?? todayIso();
  const range = resolvePeriod("custom", { from: date, to: date });

  const { data: dashData, error } = await supabase.rpc("sales_dashboard", {
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString(),
  });

  if (error) console.error(`[relatorios/caixa] erro: code=${error.code} message=${error.message}`);
  const d = (dashData as SaleDashboard) ?? null;
  const totalByPayment = d ? d.by_payment.reduce((s, p) => s + Number(p.amount), 0) : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-foreground">Fechamento de caixa</h1>
        <form method="get" className="flex items-center gap-2">
          <input type="date" name="data" defaultValue={date} className="input" max={todayIso()} />
          <button type="submit" className="btn-secondary">
            Ver
          </button>
        </form>
      </div>

      {!d ? (
        <div className="card text-sm text-muted">Sem dados pra essa data.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Faturamento" value={formatCurrency(Number(d.revenue))} tone="success" />
            <KpiCard label="Vendas" value={String(d.sales_count)} />
            <KpiCard label="Ticket médio" value={formatCurrency(Number(d.ticket_avg))} />
            <KpiCard label="Produtos vendidos" value={formatQuantity(Number(d.units_sold))} />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Descontos dados" value={formatCurrency(Number(d.discounts))} />
            <KpiCard label="Juros recebidos" value={formatCurrency(Number(d.interest))} />
            <KpiCard label="Entrada (troca)" value={formatCurrency(Number(d.trade_in_total))} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">O que deve ter no caixa, por forma de pagamento</h2>
              {d.by_payment.length === 0 ? (
                <p className="text-sm text-muted">Sem vendas nesse dia.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.by_payment.map((p) => {
                    const share = totalByPayment > 0 ? (Number(p.amount) / totalByPayment) * 100 : 0;
                    return (
                      <li key={p.method} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="text-foreground">{PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method}</span>
                        <span className="tabular-nums text-muted">
                          {formatCurrency(Number(p.amount))} · {p.sales} {p.sales === 1 ? "venda" : "vendas"} · {share.toFixed(0)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="card flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">Por vendedor</h2>
              {d.by_seller.length === 0 ? (
                <p className="text-sm text-muted">Sem vendas nesse dia.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {d.by_seller.map((s) => (
                    <li key={s.seller} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="text-foreground">{s.seller}</span>
                      <span className="tabular-nums text-muted">
                        {formatCurrency(Number(s.revenue))} · {s.sales} {s.sales === 1 ? "venda" : "vendas"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
