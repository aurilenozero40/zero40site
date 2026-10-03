import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { brandLabel } from "@/lib/sales/brands";
import { PAYMENT_LABEL } from "@/lib/sales/pricing";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/utils";
import { formatDocument, formatPhone } from "@/lib/documents";
import { ReceiptActions } from "@/components/sales/ReceiptActions";
import type { Sale, SaleItem, SalePayment } from "@/lib/types";

export const dynamic = "force-dynamic";

type ReceiptSale = Sale & {
  seller: { full_name: string } | null;
  customer: { name: string; document: string | null; phone: string | null; whatsapp: string | null } | null;
  trade_in_item: { name: string } | null;
  sale_items: SaleItem[];
  sale_payments: SalePayment[];
};

/**
 * Recibo da venda — página própria (sem menu/sidebar), só pra imprimir/baixar como PDF
 * (Ctrl+P → Salvar como PDF) ou abrir o WhatsApp com uma mensagem pronta pro cliente.
 */
export default async function ReciboPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireEmployee();

  const { data, error } = await supabase
    .from("sales")
    .select(
      "*, seller:employees!sales_seller_id_fkey(full_name), customer:customers(name, document, phone, whatsapp), trade_in_item:items!sales_trade_in_item_id_fkey(name), sale_items(*), sale_payments(*)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) console.error(`[recibo/${id}] erro: code=${error.code} message=${error.message}`);
  if (!data) notFound();

  const sale = data as unknown as ReceiptSale;
  const code = `VND-${String(sale.number).padStart(6, "0")}`;
  const pay = sale.sale_payments[0];
  const items = [...sale.sale_items].sort((a, b) => a.item_name.localeCompare(b.item_name));
  const whatsapp = sale.customer?.whatsapp || sale.customer?.phone || null;

  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 bg-white px-6 py-8 text-black print:gap-4 print:px-0 print:py-0">
      <ReceiptActions code={code} whatsapp={whatsapp} customerName={sale.customer?.name ?? null} total={Number(sale.total)} />

      <header className="flex items-start justify-between border-b border-black/20 pb-4">
        <div>
          <h1 className="text-lg font-bold">Dtudo GPS e Acessórios</h1>
          <p className="text-sm text-black/60">Recibo de venda</p>
        </div>
        <div className="text-right">
          <p className="font-mono text-base font-semibold">#{code}</p>
          <p className="text-sm text-black/60">{formatDate(sale.created_at, true)}</p>
        </div>
      </header>

      {sale.status === "cancelada" && (
        <p className="rounded border border-black/30 bg-black/5 px-3 py-2 text-sm font-semibold">
          VENDA CANCELADA{sale.cancel_reason ? ` — ${sale.cancel_reason}` : ""}
        </p>
      )}

      <section className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-black/50">Cliente</p>
          <p className="font-medium">{sale.customer?.name ?? "Não informado"}</p>
          {sale.customer?.document && <p className="text-black/60">{formatDocument(sale.customer.document)}</p>}
          {sale.customer?.phone && <p className="text-black/60">{formatPhone(sale.customer.phone)}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-black/50">Vendedor(a)</p>
          <p className="font-medium">{sale.seller?.full_name ?? "—"}</p>
        </div>
      </section>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/20 text-left text-xs uppercase tracking-wide text-black/50">
            <th className="py-2">Produto</th>
            <th className="py-2 text-right">Qtd</th>
            <th className="py-2 text-right">Preço</th>
            <th className="py-2 text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-black/10">
              <td className="py-2">
                {i.item_name}
                {Number(i.returned_quantity) > 0 && <span className="block text-xs text-black/50">devolvido: {formatQuantity(Number(i.returned_quantity))}</span>}
              </td>
              <td className="py-2 text-right tabular-nums">{formatQuantity(Number(i.quantity))}</td>
              <td className="py-2 text-right tabular-nums">{formatCurrency(Number(i.unit_price))}</td>
              <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(Number(i.line_total))}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="flex flex-col gap-1 self-end text-sm sm:w-72">
        <Row label="Subtotal" value={formatCurrency(Number(sale.subtotal))} />
        {Number(sale.discount_amount) > 0 && <Row label="Desconto" value={`− ${formatCurrency(Number(sale.discount_amount))}`} />}
        {Number(sale.interest_amount) > 0 && <Row label="Juros" value={`+ ${formatCurrency(Number(sale.interest_amount))}`} />}
        {Number(sale.trade_in_amount) > 0 && <Row label={`Entrada${sale.trade_in_item ? ` (${sale.trade_in_item.name})` : ""}`} value={`− ${formatCurrency(Number(sale.trade_in_amount))}`} />}
        <div className="my-1 border-t border-black/30" />
        <Row label="Total" value={formatCurrency(Number(sale.total))} strong />
        {Number(sale.refunded_amount) > 0 && <Row label="Reembolsado" value={`− ${formatCurrency(Number(sale.refunded_amount))}`} />}
        {pay && (
          <Row
            label="Pagamento"
            value={`${PAYMENT_LABEL[pay.method]}${pay.card_brand ? ` · ${brandLabel(pay.card_brand)}` : ""}${pay.installments > 1 ? ` · ${pay.installments}x de ${formatCurrency(Number(pay.installment_value))}` : ""}`}
          />
        )}
      </section>

      {sale.notes && (
        <p className="border-t border-black/10 pt-3 text-xs text-black/60">Obs.: {sale.notes}</p>
      )}

      <footer className="mt-auto border-t border-black/10 pt-3 text-center text-xs text-black/40">
        Obrigado pela preferência!
      </footer>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-black/60">{label}</span>
      <span className={`tabular-nums ${strong ? "text-base font-bold" : ""}`}>{value}</span>
    </div>
  );
}
