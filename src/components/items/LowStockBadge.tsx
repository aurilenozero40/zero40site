import { AlertTriangle } from "lucide-react";

export function LowStockBadge() {
  return (
    <span className="badge-low-stock">
      <AlertTriangle size={12} />
      Estoque baixo
    </span>
  );
}
