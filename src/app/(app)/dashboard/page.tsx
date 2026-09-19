import Link from "next/link";
import { AlertOctagon, Boxes, CalendarDays, CalendarRange, CircleDollarSign, Package, Receipt, ShoppingBag, Ticket, Wallet } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { LowStockAlertBanner } from "@/components/dashboard/LowStockAlertBanner";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { PeriodFilter } from "@/components/dashboard/PeriodFilter";
import { RevenueChart } from "@/components/dashboard/RevenueChart";
import { SaleStatusBadge } from "@/components/sales/SaleStatusBadge";
import { PERIODS, currentWeek, resolvePeriod, type Period } from "@/lib/dates";
import { PAYMENT_LABEL, type PaymentMethod } from "@/lib/sales/pricing";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/utils";
import type { SaleDashboard, SaleStatus, StockAlerts } from "@/lib/types";

// Sempre busca dado fresco — página autenticada e cheia de dado que muda a cada venda.
export const dynamic = "force-dynamic";

interface RecentSale {
  id: string;
  number: number;
  status: SaleStatus;
  total: number;
  created_at: string;
  seller: { full_name: string } | null;
  customer: { name: string } | null;
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ periodo?: string; de?: string; ate?: string }> }) {
  const { supabase, employee } = await requireEmployee();
  const manager = isManager(employee.role);
  const params = await searchParams;

  const period: Period = (PERIODS as readonly string[]).includes(params.periodo ?? "") ? (params.periodo as Period) : "hoje";
  const range = resolvePeriod(period, { from: params.de, to: params.ate });
  const today = resolvePeriod("hoje");
  const week = currentWeek();
  const month = resolvePeriod("mes");

  const rev = (r: { from: Date; to: Date }) => supabase.rpc("sales_revenue", { p_from: r.from.toISOString(), p_to: r.to.toISOString() });

  // O RLS decide o que cada perfil enxerga: gerente+ vê tudo; vendedor vê só o próprio faturamento.
  const [
    { data: revToday },
    { data: revWeek },
    { data: revMonth },
    { data: dashData, error: dashError },
    { data: alertsData },
    { data: recent },
    { data: inventory },
  ] = await Promise.all([
    rev(today),
    rev(week),
    rev(month),
    supabase.rpc("sales_dashboard", { p_from: range.from.toISOString(), p_to: range.to.toISOString() }),
    supabase.rpc("stock_alerts"),
    supabase
      .from("sales")
      .select("id, number, status, total, created_at, seller:employees!sales_seller_id_fkey(full_name), customer:customers(name)")
      .order("created_at", { ascending: false })
      .limit(8),
    manager ? supabase.rpc("inventory_summary") : Promise.resolve({ data: null }),
  ]);

  if (dashError) {
    console.error(`[dashboard] sales_dashboard falhou: code=${dashError.code} message=${dashError.message}`);
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <div className="card border-warning/40 bg-warning/5 text-sm text-foreground">
          O banco de dados ainda não foi atualizado para o módulo de vendas. Rode o arquivo <strong>supabase/schema.sql</strong> no SQL Editor do Supabase e recarregue.
        </div>
      </div>
    );
  }

  const d = dashData as SaleDashboard;
  const alerts = (alertsData ?? { low: [], out: [] }) as StockAlerts;
  const inv = inventory as { active_items: number; units: number; cost_value: number; sale_value: number } | null;
  const sales = (recent as unknown as RecentSale[]) ?? [];
  const totalByPayment = d.by_payment.reduce((s, p) => s + Number(p.amount), 0);
  const maxSeller = Math.max(1, ...d.by_seller.map((s) => Number(s.revenue)));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{manager ? "Dashboard" : "Meu painel"}</h1>
          <p className="text-sm text-muted">{manager ? "Visão geral da loja" : "Suas vendas"}</p>
        </div>
        <Link href="/vendas/nova" className="btn-primary md:hidden">
          Nova venda
        </Link>
      </div>

      {manager && <LowStockAlertBanner />}

      {/* Faturamento fixo: sempre hoje, semana e mês, independente do filtro abaixo */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard label="Faturamento hoje" value={formatCurrency(Number(revToday ?? 0))} icon={CalendarDays} />
        <KpiCard label="Faturamento da semana" value={formatCurrency(Number(revWeek ?? 0))} icon={CalendarRange} />
        <KpiCard label="Faturamento do mês" value={formatCurrency(Number(revMonth ?? 0))} icon={Wallet} />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">
            Período: <span className="text-accent">{range.label}</span>
          </h2>
          <PeriodFilter active={period} from={params.de} to={params.ate} />
        </div>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Faturamento" value={formatCurrency(Number(d.revenue))} icon={CircleDollarSign} tone="success" hint={Number(d.discounts) > 0 ? `${formatCurrency(Number(d.discounts))} em descontos` : undefined} />
          <KpiCard label="Vendas" value={String(d.sales_count)} icon={Receipt} />
          <KpiCard label="Ticket médio" value={formatCurrency(Number(d.ticket_avg))} icon={Ticket} />
          <KpiCard label="Produtos vendidos" value={formatQuantity(Number(d.units_sold))} icon={ShoppingBag} hint={Number(d.interest) > 0 ? `${formatCurrency(Number(d.interest))} em juros` : undefined} />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="card">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Faturamento por dia</h3>
            <RevenueChart data={d.daily} />
          </div>

          <div className="card flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">Formas de pagamento</h3>
            {d.by_payment.length === 0 ? (
              <p className="text-sm text-muted">Sem vendas no período.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {d.by_payment.map((p) => {
                  const share = totalByPayment > 0 ? (Number(p.amount) / totalByPayment) * 100 : 0;
                  return (
                    <li key={p.method} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-foreground">{PAYMENT_LABEL[p.method as PaymentMethod] ?? p.method}</span>
                        <span className="tabular-nums text-muted">
                          {formatCurrency(Number(p.amount))} · {share.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-background">
                        <div className="h-full rounded-full bg-gradient-to-r from-accent to-accent-alt" style={{ width: `${share}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {manager && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="card flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-foreground">Vendas por vendedor</h3>
              {d.by_seller.length === 0 ? (
                <p className="text-sm text-muted">Sem vendas no período.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {d.by_seller.map((s, i) => (
                    <li key={s.seller} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="text-foreground">
                          <span className="mr-2 text-xs text-muted">{i + 1}º</span>
                          {s.seller}
                        </span>
                        <span className="tabular-nums text-muted">
                          {formatCurrency(Number(s.revenue))} · {s.sales} {s.sales === 1 ? "venda" : "vendas"}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-background">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${(Number(s.revenue) / maxSeller) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card flex flex-col gap-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <AlertOctagon size={16} className="text-danger" /> Produtos esgotados
                <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs text-danger">{alerts.out.length}</span>
              </h3>
              {alerts.out.length === 0 ? (
                <p className="text-sm text-muted">Nenhum produto esgotado.</p>
              ) : (
                <ul className="flex max-h-52 flex-col divide-y divide-border overflow-y-auto text-sm">
                  {alerts.out.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                      <Link href={`/itens/${i.id}`} className="truncate text-foreground hover:underline">
                        {i.name}
                      </Link>
                      <span className="shrink-0 text-xs text-danger">0 {i.unit}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted">Produtos recém-cadastrados, ainda sem nenhuma entrada, não contam como esgotados.</p>
            </div>
          </div>
        )}
      </div>

      {manager && inv && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Produtos ativos" value={String(inv.active_items)} icon={Package} />
          <KpiCard label="Unidades em estoque" value={formatQuantity(Number(inv.units))} icon={Boxes} />
          <KpiCard label="Estoque a custo" value={formatCurrency(Number(inv.cost_value))} icon={Wallet} />
          <KpiCard label="Estoque a preço de venda" value={formatCurrency(Number(inv.sale_value))} icon={CircleDollarSign} />
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Vendas recentes</h2>
          <Link href="/vendas" className="text-xs font-medium text-accent hover:underline">
            Ver todas
          </Link>
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Venda</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Cliente</th>
                {manager && <th className="px-4 py-3">Vendedor</th>}
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((s) => (
                <tr key={s.id} className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.04]">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/vendas/${s.id}`} className="text-accent hover:underline">
                      #VND-{String(s.number).padStart(6, "0")}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDate(s.created_at, true)}</td>
                  <td className="px-4 py-3 text-muted">{s.customer?.name ?? "—"}</td>
                  {manager && <td className="px-4 py-3 text-muted">{s.seller?.full_name ?? "—"}</td>}
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">{formatCurrency(Number(s.total))}</td>
                  <td className="px-4 py-3">
                    <SaleStatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={manager ? 6 : 5} className="px-4 py-10 text-center text-muted">
                    Nenhuma venda registrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
