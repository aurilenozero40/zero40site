import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

function buildWarrantyRows(
  data: {
    sale_id: string;
    item_id: string;
    item_name: string;
    sales: { created_at: string; status: string; customer: { name: string; phone: string | null } | null } | null;
  }[],
  monthsByItem: Map<string, number>
): WarrantyRow[] {
  const now = Date.now();
  return data
    .filter((r) => r.sales && r.sales.status !== "cancelada")
    .map((r) => {
      const months = monthsByItem.get(r.item_id) ?? 0;
      const expiresAt = new Date(r.sales!.created_at);
      expiresAt.setMonth(expiresAt.getMonth() + months);
      const daysLeft = Math.round((expiresAt.getTime() - now) / 86_400_000);
      return {
        saleId: r.sale_id,
        itemName: r.item_name,
        customerName: r.sales!.customer?.name ?? null,
        customerPhone: r.sales!.customer?.phone ?? null,
        soldAt: r.sales!.created_at,
        expiresAt,
        expired: daysLeft < 0,
        daysLeft,
      };
    })
    .filter((r) => r.daysLeft >= -7 && r.daysLeft <= 30)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

interface WarrantyRow {
  saleId: string;
  itemName: string;
  customerName: string | null;
  customerPhone: string | null;
  soldAt: string;
  expiresAt: Date;
  expired: boolean;
  daysLeft: number;
}

/** Garantias vencendo nos próximos 30 dias (ou vencidas há até 7) — pra avisar o cliente antes. */
export default async function RelatorioGarantiasPage() {
  const { supabase } = await requireManager();

  const { data: warrantyItems } = await supabase.from("items").select("id, warranty_months").not("warranty_months", "is", null);
  const itemIds = (warrantyItems ?? []).map((i) => i.id as string);
  const monthsByItem = new Map((warrantyItems ?? []).map((i) => [i.id as string, i.warranty_months as number]));

  let rows: WarrantyRow[] = [];
  if (itemIds.length > 0) {
    const { data } = await supabase
      .from("sale_items")
      .select("sale_id, item_id, item_name, sales(created_at, status, customer:customers(name, phone))")
      .in("item_id", itemIds);

    rows = buildWarrantyRows(
      (data ?? []) as unknown as {
        sale_id: string;
        item_id: string;
        item_name: string;
        sales: { created_at: string; status: string; customer: { name: string; phone: string | null } | null } | null;
      }[],
      monthsByItem
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Garantias</h1>
        <p className="text-sm text-muted">Vencendo nos próximos 30 dias, ou vencidas há até 7 — produtos com garantia controlada no cadastro.</p>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Vendido em</th>
              <th className="px-4 py-3">Garantia até</th>
              <th className="px-4 py-3">Situação</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.saleId}-${r.itemName}`} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/vendas/${r.saleId}`} className="font-medium text-foreground hover:underline">
                    {r.itemName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted">
                  {r.customerName ?? "Não informado"}
                  {r.customerPhone && <span className="block text-xs">{r.customerPhone}</span>}
                </td>
                <td className="px-4 py-3 text-muted">{formatDate(r.soldAt)}</td>
                <td className="px-4 py-3 text-muted">{formatDate(r.expiresAt)}</td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      r.expired ? "bg-danger/10 text-danger" : r.daysLeft <= 7 ? "bg-warning/10 text-warning" : "bg-muted/20 text-muted"
                    )}
                  >
                    {r.expired ? `Vencida há ${Math.abs(r.daysLeft)}d` : `Vence em ${r.daysLeft}d`}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Nenhuma garantia vencendo nos próximos 30 dias.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
