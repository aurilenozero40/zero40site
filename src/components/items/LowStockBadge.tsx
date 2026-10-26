import { AlertTriangle } from "lucide-react";

/** status vem de stock_alerts() (regra única no banco): "baixo" = abaixo do mínimo · "esgotado" = saldo 0. */
export function LowStockBadge({ status = "baixo" }: { status?: "baixo" | "esgotado" }) {
  return (
    <span className="badge-low-stock">
      <AlertTriangle size={12} />
      {status === "esgotado" ? "Esgotado" : "Estoque baixo"}
    </span>
  );
}
