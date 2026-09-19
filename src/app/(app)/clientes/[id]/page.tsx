import Link from "next/link";
import { notFound } from "next/navigation";
import { Power } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { CustomerForm } from "@/components/customers/CustomerForm";
import { SaleStatusBadge } from "@/components/sales/SaleStatusBadge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PAYMENT_LABEL } from "@/lib/sales/pricing";
import type { Customer, Sale, SalePayment } from "@/lib/types";
import { toggleCustomerActive, updateCustomer } from "../actions";

export const dynamic = "force-dynamic";

type SaleRow = Pick<Sale, "id" | "number" | "status" | "total" | "refunded_amount" | "created_at"> & { sale_payments: Pick<SalePayment, "method" | "installments">[] };

export default async function ClienteDetalhePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, employee } = await requireEmployee();
  const manager = isManager(employee.role);

  const [{ data: customer }, { data: sales }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    // RLS: gerente+ vê todas as compras do cliente; vendedor vê só as que ele mesmo vendeu
    supabase
      .from("sales")
      .select("id, number, status, total, refunded_amount, created_at, sale_payments(method, installments)")
      .eq("customer_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (!customer) notFound();
  const c = customer as Customer;
  const rows = (sales as unknown as SaleRow[]) ?? [];
  const spent = rows.filter((s) => s.status !== "cancelada").reduce((sum, s) => sum + Number(s.total) - Number(s.refunded_amount), 0);
  const toggle = toggleCustomerActive.bind(null, id, !c.active);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/clientes" className="text-xs text-muted hover:underline">
            ← Voltar para clientes
          </Link>
          <h1 className="text-xl font-semibold text-foreground">
            {c.name}
            {!c.active && <span className="ml-2 text-sm font-normal text-muted">(inativo)</span>}
          </h1>
        </div>
        <div className="flex gap-2">
          {manager && (
            <form action={toggle}>
              <button type="submit" className="btn-secondary">
                <Power size={15} />
                {c.active ? "Desativar" : "Reativar"}
              </button>
            </form>
          )}
        </div>
      </div>

      <div className="max-w-2xl">
        <CustomerForm action={updateCustomer.bind(null, id)} customer={c} />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <h2 className="text-sm font-semibold text-foreground">Histórico de compras</h2>
          {rows.length > 0 && (
            <p className="text-xs text-muted">
              {rows.length} {rows.length === 1 ? "compra" : "compras"} · {formatCurrency(spent)} no total
            </p>
          )}
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Venda</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Pagamento</th>
                <th className="px-4 py-3 text-right">Total</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.04]">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link href={`/vendas/${s.id}`} className="text-accent hover:underline">
                      #VND-{String(s.number).padStart(6, "0")}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted">{formatDate(s.created_at, true)}</td>
                  <td className="px-4 py-3 text-muted">
                    {s.sale_payments[0] ? `${PAYMENT_LABEL[s.sale_payments[0].method]}${s.sale_payments[0].installments > 1 ? ` ${s.sale_payments[0].installments}x` : ""}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatCurrency(Number(s.total))}</td>
                  <td className="px-4 py-3">
                    <SaleStatusBadge status={s.status} />
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    {manager ? "Nenhuma compra registrada." : "Nenhuma compra sua com esse cliente."}
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
