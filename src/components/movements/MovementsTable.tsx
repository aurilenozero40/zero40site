import { Inbox } from "lucide-react";
import type { MovementWithRelations } from "@/lib/types";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/utils";

const TYPE_LABEL: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  ajuste: "Ajuste",
};

const TYPE_CLASS: Record<string, string> = {
  entrada: "bg-success/10 text-success",
  saida: "bg-danger/10 text-danger",
  ajuste: "bg-warning/10 text-warning",
};

const PAYMENT_LABEL: Record<string, string> = {
  a_vista: "À vista",
  pix: "Pix",
  cartao: "Cartão",
};

const SUBTYPE_LABEL: Record<string, string> = {
  compra: "Compra",
  devolucao: "Devolução",
  transferencia: "Transferência",
  cancelamento: "Cancelamento",
  troca: "Entrada (troca)",
  uso: "Uso interno",
  perda: "Perda",
  venda: "Venda",
  emprestimo: "Empréstimo",
  outros: "Outros",
};

export function MovementsTable({
  movements,
  showItem = true,
  showSupplier = true,
  showSeller = true,
  unitLabel = "Valor unit.",
}: {
  movements: MovementWithRelations[];
  showItem?: boolean;
  /** coluna de fornecedor (só faz sentido onde há entradas) */
  showSupplier?: boolean;
  /** coluna "Vendedor da venda" (quem leva a comissão) ao lado do operador (quem registrou) */
  showSeller?: boolean;
  /** nas entradas o valor unitário é o CUSTO de compra */
  unitLabel?: string;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            {showItem && <th className="px-4 py-3">Item</th>}
            <th className="px-4 py-3">Tipo</th>
            <th className="px-4 py-3">Quantidade</th>
            <th className="px-4 py-3 text-right">{unitLabel}</th>
            <th className="px-4 py-3 text-right">Valor total</th>
            {showSupplier && <th className="px-4 py-3">Fornecedor</th>}
            <th className="px-4 py-3">Pagamento</th>
            <th className="px-4 py-3">Operador (registrou)</th>
            {showSeller && <th className="px-4 py-3">Vendedor da venda</th>}
            <th className="px-4 py-3">Quando</th>
            <th className="px-4 py-3">Canal</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0 transition-colors hover:bg-foreground/[0.04]">
              {showItem && (
                <td className="px-4 py-3 font-medium text-foreground">
                  {m.items?.name ?? "-"}
                  {/* produtos de mesmo nome (SKUs diferentes) só se distinguem pelo SKU */}
                  <span className="block font-mono text-xs font-normal text-muted">{m.items?.sku ?? "sem SKU"}</span>
                </td>
              )}
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_CLASS[m.type]}`}
                >
                  {TYPE_LABEL[m.type]}
                  {m.subtype ? ` · ${SUBTYPE_LABEL[m.subtype] ?? m.subtype}` : ""}
                </span>
              </td>
              <td className="px-4 py-3 tabular-nums">{formatQuantity(m.quantity, m.items?.unit)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted">{formatCurrency(m.unit_value)}</td>
              <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                {formatCurrency(m.total_value)}
              </td>
              {showSupplier && <td className="px-4 py-3 text-muted">{m.suppliers?.name ?? "-"}</td>}
              <td className="px-4 py-3 text-muted">
                {m.payment_method
                  ? `${PAYMENT_LABEL[m.payment_method]}${
                      m.installments ? ` (${m.installments}x)` : ""
                    }`
                  : "-"}
              </td>
              <td className="px-4 py-3 text-muted">{m.employees?.full_name ?? "-"}</td>
              {showSeller && (
                <td className="px-4 py-3 text-muted">
                  {m.sales ? (
                    <>
                      {m.sales.seller?.full_name ?? "-"}
                      <span className="block text-xs">#VND-{String(m.sales.number).padStart(6, "0")}</span>
                    </>
                  ) : (
                    "-"
                  )}
                </td>
              )}
              <td className="px-4 py-3 text-muted">{formatDate(m.created_at, true)}</td>
              <td className="px-4 py-3 text-muted capitalize">{m.source_channel}</td>
            </tr>
          ))}
          {movements.length === 0 && (
            <tr>
              <td colSpan={(showItem ? 9 : 8) + (showSupplier ? 1 : 0) + (showSeller ? 1 : 0)} className="px-4 py-12 text-center">
                <div className="flex flex-col items-center gap-2 text-muted">
                  <Inbox size={24} className="opacity-50" />
                  <span className="text-sm">Nenhuma movimentação encontrada.</span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
