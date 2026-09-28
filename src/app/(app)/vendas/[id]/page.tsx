import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Plus } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { SaleActions } from "@/components/sales/SaleActions";
import { SaleStatusBadge } from "@/components/sales/SaleStatusBadge";
import { brandLabel } from "@/lib/sales/brands";
import { PAYMENT_LABEL } from "@/lib/sales/pricing";
import { EVENT_LABEL, type EventType } from "@/lib/notifications/types";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/utils";
import { formatDocument } from "@/lib/documents";
import type { AuditLog, Sale, SaleItem, SalePayment } from "@/lib/types";

export const dynamic = "force-dynamic";

type SaleDetail = Sale & {
  seller: { full_name: string } | null;
  canceller: { full_name: string } | null;
  customer: { id: string; name: string; document: string | null; phone: string | null } | null;
  trade_in_item: { id: string; name: string; active: boolean } | null;
  sale_items: (SaleItem & { items: { track_serial: boolean } | null })[];
  sale_payments: SalePayment[];
};

interface OutboxInfo {
  id: string;
  event_type: EventType;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
}

const OUTBOX_LABEL: Record<string, string> = { pending: "Pendente", sending: "Enviando", sent: "Enviada", failed: "Falhou", skipped: "Ignorada" };

const AUDIT_LABEL: Record<string, string> = {
  "sale.created": "Venda registrada",
  "sale.cancelled": "Venda cancelada",
  "sale.returned": "Devolução registrada",
};

export default async function VendaDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ criada?: string }>;
}) {
  const { id } = await params;
  const created = (await searchParams).criada === "1";
  const { supabase, employee } = await requireEmployee();
  const manager = isManager(employee.role);

  const { data, error } = await supabase
    .from("sales")
    .select(
      "*, seller:employees!sales_seller_id_fkey(full_name), canceller:employees!sales_cancelled_by_fkey(full_name), customer:customers(id, name, document, phone), trade_in_item:items!sales_trade_in_item_id_fkey(id, name, active), sale_items(*, items(track_serial)), sale_payments(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error(`[vendas/${id}] erro: code=${error.code} message=${error.message}`);
  if (!data) notFound(); // não existe — ou é de outro vendedor (RLS)

  const sale = data as unknown as SaleDetail;
  const code = `VND-${String(sale.number).padStart(6, "0")}`;
  const pay = sale.sale_payments[0];
  const items = [...sale.sale_items].sort((a, b) => a.item_name.localeCompare(b.item_name));

  // Seriais ainda vinculados a esta venda (voltam pro estoque e somem daqui em cancelamento/devolução).
  const serialItemIds = items.filter((i) => i.items?.track_serial).map((i) => i.id);
  const { data: serialRows } = serialItemIds.length
    ? await supabase.from("item_serials").select("serial, sale_item_id").in("sale_item_id", serialItemIds).eq("status", "vendido")
    : { data: [] as { serial: string; sale_item_id: string }[] };
  const serialsBySaleItem = new Map<string, string[]>();
  for (const r of serialRows ?? []) serialsBySaleItem.set(r.sale_item_id, [...(serialsBySaleItem.get(r.sale_item_id) ?? []), r.serial]);

  // Só gerente+ enxerga auditoria e fila (RLS): quem fez o quê, e se o CEO foi avisado.
  const [{ data: audit }, { data: outbox }] = manager
    ? await Promise.all([
        supabase.from("audit_logs").select("*").eq("entity_type", "sale").eq("entity_id", id).order("created_at"),
        supabase.from("notification_outbox").select("id, event_type, status, attempts, last_error, sent_at").eq("entity_id", id).order("created_at"),
      ])
    : [{ data: [] as AuditLog[] }, { data: [] as OutboxInfo[] }];

  return (
    <div className="flex flex-col gap-6">
      {created && (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-success/40 bg-success/5">
          <div className="flex items-center gap-2 text-success">
            <CheckCircle2 size={20} />
            <div>
              <p className="font-semibold">Venda registrada com sucesso!</p>
              <p className="text-xs text-muted">Estoque atualizado{manager ? " e CEO notificado no Telegram" : ""}.</p>
            </div>
          </div>
          <Link href="/vendas/nova" className="btn-primary">
            <Plus size={16} /> Nova venda
          </Link>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/vendas" className="text-xs text-muted hover:underline">
            ← Voltar para vendas
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-xl font-semibold text-foreground">#{code}</h1>
            <SaleStatusBadge status={sale.status} />
          </div>
          <p className="text-sm text-muted">
            {formatDate(sale.created_at, true)} · vendedor {sale.seller?.full_name ?? "—"}
          </p>
        </div>
        {manager && (
          <SaleActions
            saleId={sale.id}
            code={code}
            status={sale.status}
            total={Number(sale.total)}
            items={items.map((i) => ({
              id: i.id,
              name: i.item_name,
              unit: "",
              quantity: Number(i.quantity),
              returned: Number(i.returned_quantity),
              trackSerial: i.items?.track_serial ?? false,
              soldSerials: serialsBySaleItem.get(i.id) ?? [],
            }))}
          />
        )}
      </div>

      {sale.status === "cancelada" && (
        <div className="card border-danger/30 bg-danger/5 text-sm">
          <p className="font-semibold text-danger">Venda cancelada</p>
          <p className="text-foreground">
            {sale.canceller?.full_name ?? "—"} em {sale.cancelled_at ? formatDate(sale.cancelled_at, true) : "—"}: {sale.cancel_reason}
          </p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-6">
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3 text-right">Qtd</th>
                  <th className="px-4 py-3 text-right">Preço</th>
                  <th className="px-4 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/itens/${i.item_id}`} className="font-medium text-foreground hover:underline">
                        {i.item_name}
                      </Link>
                      <p className="font-mono text-xs text-muted">{[i.item_sku, i.item_barcode].filter(Boolean).join(" · ")}</p>
                      {i.items?.track_serial && (
                        <p className="font-mono text-xs text-muted">{(serialsBySaleItem.get(i.id) ?? []).join(", ") || "—"}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatQuantity(Number(i.quantity))}
                      {Number(i.returned_quantity) > 0 && <p className="text-xs text-warning">devolvido: {formatQuantity(Number(i.returned_quantity))}</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted">{formatCurrency(Number(i.unit_price))}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">{formatCurrency(Number(i.line_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {manager && (
            <div className="card flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">Histórico da venda</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {((audit as AuditLog[]) ?? []).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                    <span>
                      <span className="font-medium text-foreground">{AUDIT_LABEL[a.action] ?? a.action}</span>
                      <span className="text-muted"> · {a.actor_name ?? "Sistema"}</span>
                      {typeof a.changes?.reason === "string" && <span className="block text-xs text-muted">Motivo: {a.changes.reason}</span>}
                    </span>
                    <span className="text-xs text-muted">{formatDate(a.created_at, true)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <div className="card flex flex-col gap-2 text-sm">
            <h2 className="text-sm font-semibold text-foreground">Valores</h2>
            <Line label="Subtotal" value={formatCurrency(Number(sale.subtotal))} />
            {Number(sale.discount_amount) > 0 && <Line label="Desconto" value={`− ${formatCurrency(Number(sale.discount_amount))}`} className="text-success" />}
            {Number(sale.interest_amount) > 0 && <Line label={`Juros (${Number(pay?.interest_percent ?? 0).toLocaleString("pt-BR")}%)`} value={`+ ${formatCurrency(Number(sale.interest_amount))}`} className="text-warning" />}
            {Number(sale.trade_in_amount) > 0 && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted">
                  Entrada:{" "}
                  {sale.trade_in_item ? (
                    <Link href={`/itens/${sale.trade_in_item.id}`} className="text-accent hover:underline">
                      {sale.trade_in_item.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </span>
                <span className="tabular-nums text-success">− {formatCurrency(Number(sale.trade_in_amount))}</span>
              </div>
            )}
            <div className="border-t border-border" />
            <Line label="Total pago pelo cliente" value={formatCurrency(Number(sale.total))} strong />
            {Number(sale.refunded_amount) > 0 && <Line label="Reembolsado" value={`− ${formatCurrency(Number(sale.refunded_amount))}`} className="text-danger" />}
          </div>

          {pay && (
            <div className="card flex flex-col gap-2 text-sm">
              <h2 className="text-sm font-semibold text-foreground">Pagamento</h2>
              <Line label="Forma" value={PAYMENT_LABEL[pay.method]} />
              {pay.card_brand && <Line label="Bandeira" value={brandLabel(pay.card_brand)} />}
              {pay.installments > 1 && <Line label="Parcelas" value={`${pay.installments}x de ${formatCurrency(Number(pay.installment_value))}`} />}
              {manager && pay.fee_amount !== null && (
                <>
                  <Line label={`Taxa da operadora (${Number(pay.fee_percent).toLocaleString("pt-BR")}%)`} value={`− ${formatCurrency(Number(pay.fee_amount))}`} className="text-danger" />
                  <Line label="Líquido a receber" value={formatCurrency(Number(pay.net_amount))} strong />
                </>
              )}
            </div>
          )}

          <div className="card flex flex-col gap-1 text-sm">
            <h2 className="mb-1 text-sm font-semibold text-foreground">Cliente</h2>
            {sale.customer ? (
              <>
                <Link href={`/clientes/${sale.customer.id}`} className="font-medium text-accent hover:underline">
                  {sale.customer.name}
                </Link>
                {sale.customer.document && <span className="text-xs text-muted">{formatDocument(sale.customer.document)}</span>}
              </>
            ) : (
              <span className="text-muted">Não informado</span>
            )}
            {sale.notes && <p className="mt-2 text-xs text-muted">Obs.: {sale.notes}</p>}
          </div>

          {manager && ((outbox as OutboxInfo[]) ?? []).length > 0 && (
            <div className="card flex flex-col gap-2 text-sm">
              <h2 className="text-sm font-semibold text-foreground">Notificação ao CEO (Telegram)</h2>
              {((outbox as OutboxInfo[]) ?? []).map((n) => (
                <div key={n.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted">{EVENT_LABEL[n.event_type] ?? n.event_type}</span>
                  <span className={n.status === "sent" ? "font-medium text-success" : n.status === "failed" ? "font-medium text-danger" : "font-medium text-warning"} title={n.last_error ?? undefined}>
                    {OUTBOX_LABEL[n.status] ?? n.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Line({ label, value, className, strong }: { label: string; value: string; className?: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-semibold text-foreground" : "text-foreground"} ${className ?? ""}`}>{value}</span>
    </div>
  );
}
