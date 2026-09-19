import { cn } from "@/lib/utils";
import type { SaleStatus } from "@/lib/types";

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  pendente: "Pendente",
  concluida: "Concluída",
  cancelada: "Cancelada",
  devolvida: "Devolvida",
  parcialmente_devolvida: "Parcialmente devolvida",
};

const STYLE: Record<SaleStatus, string> = {
  pendente: "bg-warning/10 text-warning",
  concluida: "bg-success/10 text-success",
  cancelada: "bg-danger/10 text-danger",
  devolvida: "bg-warning/10 text-warning",
  parcialmente_devolvida: "bg-warning/10 text-warning",
};

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return (
    <span className={cn("inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", STYLE[status])}>
      {SALE_STATUS_LABEL[status]}
    </span>
  );
}
