import Link from "next/link";
import { BellOff } from "lucide-react";
import type { NotificationHealth } from "@/lib/notifications/health";

/**
 * Aviso no topo quando o canal de avisos (Telegram) está quebrado. As vendas continuam normais —
 * só o aviso ao CEO não chega — e o texto deixa isso claro.
 */
export function NotificationHealthBanner({ health, showLink = true }: { health: NotificationHealth; showLink?: boolean }) {
  if (health.ok) return null;
  return (
    <div role="alert" className="card flex items-start gap-3 border-warning/40 bg-warning/5 text-sm">
      <BellOff size={18} className="mt-0.5 shrink-0 text-warning" />
      <div>
        <p className="font-medium text-foreground">Avisos ao CEO (Telegram) não estão funcionando</p>
        <p className="text-muted">
          {health.problem} As vendas continuam sendo registradas normalmente; os avisos ficam na fila e são enviados quando o canal for corrigido.
          {showLink && (
            <>
              {" "}
              <Link href="/configuracoes" className="font-medium text-foreground underline">
                Ver configurações
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
