import { renderMessage } from "./templates";
import {
  NotificationError,
  type NotificationChannel,
  type OutboxRow,
  type OutboxStore,
  type ProcessSummary,
} from "./types";

interface Logger {
  error: (...args: unknown[]) => void;
}

/**
 * Lê a fila (notification_outbox) e entrega pelos canais. Regras:
 *  • a venda já está gravada — falha de notificação NUNCA desfaz nada, só agenda retry;
 *  • cada item da fila é reivindicado por UM worker (SKIP LOCKED no banco) → sem envio em dobro;
 *  • canal sem configuração deixa a fila parada (nada é reivindicado nem gasta tentativa).
 */
export class NotificationService {
  constructor(
    private readonly store: OutboxStore,
    private readonly channels: Record<string, NotificationChannel>,
    private readonly log: Logger = console,
    private readonly now: () => Date = () => new Date()
  ) {}

  async processPending(limit = 10): Promise<ProcessSummary> {
    const registered = Object.values(this.channels);
    if (registered.length === 0 || registered.some((c) => !c.isConfigured())) {
      return { claimed: 0, sent: 0, retrying: 0, failed: 0, notConfigured: true };
    }

    const rows = await this.store.claim(limit);
    const summary: ProcessSummary = { claimed: rows.length, sent: 0, retrying: 0, failed: 0 };

    for (const row of rows) {
      const outcome = await this.deliver(row);
      summary[outcome]++;
    }
    return summary;
  }

  private async deliver(row: OutboxRow): Promise<"sent" | "retrying" | "failed"> {
    const channel = this.channels[row.channel];
    if (!channel) {
      await this.store.markFailed(row.id, `Canal desconhecido: ${row.channel}`, false);
      return "failed";
    }

    let message;
    try {
      message = renderMessage(row.event_type, row.payload, { sentAt: this.now() });
    } catch (err) {
      // payload/template quebrado: repetir não adianta
      await this.store.markFailed(row.id, `Erro ao montar mensagem: ${(err as Error).message}`, false);
      this.log.error("[notificacoes] falha ao montar mensagem", row.id, err);
      return "failed";
    }

    try {
      await channel.send(message);
    } catch (err) {
      const retryable = err instanceof NotificationError ? err.retryable : true;
      const text = (err as Error).message;
      await this.store.markFailed(row.id, text, retryable);
      this.log.error("[notificacoes] falha ao enviar", row.id, text);
      const willRetry = retryable && row.attempts < row.max_attempts;
      return willRetry ? "retrying" : "failed";
    }

    await this.store.markSent(row.id);
    return "sent";
  }
}
