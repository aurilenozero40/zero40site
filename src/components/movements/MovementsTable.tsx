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

export function MovementsTable({
  movements,
  showItem = true,
}: {
  movements: MovementWithRelations[];
  showItem?: boolean;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase text-muted">
            {showItem && <th className="px-4 py-3">Item</th>}
            <th className="px-4 py-3">Tipo</th>
            <th className="px-4 py-3">Quantidade</th>
            <th className="px-4 py-3">Valor</th>
            <th className="px-4 py-3">Pagamento</th>
            <th className="px-4 py-3">Quem fez</th>
            <th className="px-4 py-3">Quando</th>
            <th className="px-4 py-3">Canal</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id} className="border-b border-border last:border-0">
              {showItem && (
                <td className="px-4 py-3 font-medium text-foreground">
                  {m.items?.name ?? "-"}
                </td>
              )}
              <td className="px-4 py-3">
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${TYPE_CLASS[m.type]}`}
                >
                  {TYPE_LABEL[m.type]}
                  {m.subtype ? ` · ${m.subtype}` : ""}
                </span>
              </td>
              <td className="px-4 py-3">{formatQuantity(m.quantity, m.items?.unit)}</td>
              <td className="px-4 py-3">{formatCurrency(m.total_value)}</td>
              <td className="px-4 py-3 text-muted">
                {m.payment_method
                  ? `${PAYMENT_LABEL[m.payment_method]}${
                      m.installments ? ` (${m.installments}x)` : ""
                    }`
                  : "-"}
              </td>
              <td className="px-4 py-3 text-muted">{m.employees?.full_name ?? "-"}</td>
              <td className="px-4 py-3 text-muted">{formatDate(m.created_at, true)}</td>
              <td className="px-4 py-3 text-muted capitalize">{m.source_channel}</td>
            </tr>
          ))}
          {movements.length === 0 && (
            <tr>
              <td colSpan={showItem ? 8 : 7} className="px-4 py-8 text-center text-muted">
                Nenhuma movimentação encontrada.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
