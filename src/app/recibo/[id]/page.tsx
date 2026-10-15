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
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 bg-[#ededed] px-4 py-8 print:bg-white print:px-0 print:py-0">
      <ReceiptActions code={code} whatsapp={whatsapp} customerName={sale.customer?.name ?? null} total={Number(sale.total)} />

      <div
        id="recibo-content"
        className="flex flex-col gap-5 rounded-lg bg-white px-8 py-8 text-black shadow-sm print:gap-3 print:rounded-none print:px-0 print:py-0 print:text-[11px] print:shadow-none"
      >
        <header className="flex items-start justify-between gap-4 border-b-2 border-black pb-4 print:flex-col print:items-center print:gap-1 print:border-b print:pb-2 print:text-center">
          <div className="print:flex print:flex-col print:items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- captura por html2canvas precisa de <img> direta, sem otimização do next/image */}
            <img src="/brand/logo-dtudo.png" alt="Dtudo" className="h-10 w-auto object-contain print:h-12" />
            <p className="mt-1 text-sm text-black/60 print:mt-0.5 print:text-[11px]">Recibo de venda</p>
          </div>
          <div className="text-right print:text-center">
            <p className="font-mono text-base font-semibold print:text-[11px]">#{code}</p>
            <p className="text-sm text-black/60 print:text-[10px]">{formatDate(sale.created_at, true)}</p>
          </div>
        </header>

        {sale.status === "cancelada" && (
          <p className="rounded border border-black/30 bg-black/5 px-3 py-2 text-sm font-semibold print:text-center print:text-[11px]">
            VENDA CANCELADA{sale.cancel_reason ? ` — ${sale.cancel_reason}` : ""}
          </p>
        )}

        <section className="grid grid-cols-2 gap-4 rounded-md bg-black/[0.03] p-4 text-sm print:grid-cols-1 print:gap-1 print:bg-transparent print:p-0 print:text-[11px]">
          <div>
            <p className="text-xs uppercase tracking-wide text-black/50 print:text-[9px]">Cliente</p>
            <p className="font-medium">{sale.customer?.name ?? "Não informado"}</p>
            {sale.customer?.document && <p className="text-black/60">{formatDocument(sale.customer.document)}</p>}
            {sale.customer?.phone && <p className="text-black/60">{formatPhone(sale.customer.phone)}</p>}
          </div>
          <div className="text-right print:text-left">
            <p className="text-xs uppercase tracking-wide text-black/50 print:text-[9px]">Vendedor(a)</p>
            <p className="font-medium">{sale.seller?.full_name ?? "—"}</p>
          </div>
        </section>

        {/* Tela: tabela com colunas. Impressão (bobina estreita): lista empilhada — não cabem 4 colunas em 80mm. */}
        <table className="w-full text-sm print:hidden">
          <thead>
            <tr className="border-b-2 border-black/80 text-left text-xs uppercase tracking-wide text-black/50">
              <th className="py-2">Produto</th>
              <th className="py-2 text-right">Qtd</th>
              <th className="py-2 text-right">Preço</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-black/10">
                <td className="py-2.5">
                  {i.item_name}
                  {Number(i.returned_quantity) > 0 && <span className="block text-xs text-black/50">devolvido: {formatQuantity(Number(i.returned_quantity))}</span>}
                </td>
                <td className="py-2.5 text-right tabular-nums">{formatQuantity(Number(i.quantity))}</td>
                <td className="py-2.5 text-right tabular-nums">{formatCurrency(Number(i.unit_price))}</td>
                <td className="py-2.5 text-right tabular-nums font-medium">{formatCurrency(Number(i.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="hidden flex-col gap-2 border-b border-black/80 border-t-2 border-t-black/80 py-2 text-[11px] print:flex">
          {items.map((i) => (
            <div key={i.id} className="flex flex-col gap-0.5 border-b border-dashed border-black/20 pb-1.5 last:border-0">
              <span className="font-medium">{i.item_name}</span>
              <div className="flex items-center justify-between tabular-nums text-black/70">
                <span>
                  {formatQuantity(Number(i.quantity))} x {formatCurrency(Number(i.unit_price))}
                </span>
                <span className="font-medium text-black">{formatCurrency(Number(i.line_total))}</span>
              </div>
              {Number(i.returned_quantity) > 0 && (
                <span className="text-black/50">devolvido: {formatQuantity(Number(i.returned_quantity))}</span>
              )}
            </div>
          ))}
        </div>

        <section className="flex flex-col gap-1.5 self-end rounded-md bg-black/[0.03] p-4 text-sm sm:w-72 print:w-full print:gap-1 print:bg-transparent print:p-0 print:text-[11px]">
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
          <p className="border-t border-black/10 pt-3 text-xs text-black/60 print:text-[10px]">Obs.: {sale.notes}</p>
        )}

        <footer className="mt-auto flex flex-col items-center gap-2 border-t border-black/10 pt-4 text-center print:pt-2">
          <p className="text-xs text-black/40 print:text-[10px]">Obrigado pela preferência!</p>
          <p className="max-w-md text-[9px] leading-snug text-black/35">
            Não substitui a nota fiscal/cupom fiscal.
          </p>
        </footer>
      </div>
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
