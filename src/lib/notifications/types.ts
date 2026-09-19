// Contratos da camada de notificações. O domínio de vendas NÃO conhece o Telegram: ele só grava
// eventos na fila (notification_outbox, dentro da mesma transação da venda). Este módulo lê a
// fila e entrega por um "canal" — hoje Telegram; WhatsApp/e-mail entram como novos canais.

export const EVENT_TYPES = [
  "SALE_COMPLETED",
  "SALE_CANCELLED",
  "SALE_RETURNED",
  "LOW_STOCK",
  "OUT_OF_STOCK",
  "STOCK_ENTRY",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABEL: Record<EventType, string> = {
  SALE_COMPLETED: "Venda realizada",
  SALE_CANCELLED: "Venda cancelada",
  SALE_RETURNED: "Devolução",
  LOW_STOCK: "Estoque baixo",
  OUT_OF_STOCK: "Produto esgotado",
  STOCK_ENTRY: "Entrada de estoque",
};

export type OutboxStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

/** Linha da tabela notification_outbox. */
export interface OutboxRow {
  id: string;
  event_type: EventType;
  entity_type: string;
  entity_id: string;
  channel: string;
  dedupe_key: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface RenderedMessage {
  text: string;
  /** Telegram: "HTML" quando o texto usa <b>…</b>. */
  parseMode?: "HTML";
}

/** Falha de entrega. `retryable` = vale tentar de novo (rede, 429, 5xx); false = erro permanente. */
export class NotificationError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = "NotificationError";
  }
}

export interface NotificationChannel {
  readonly name: string;
  /** Tem credenciais/destino? Sem isso a fila fica parada (pendente), sem gastar tentativas. */
  isConfigured(): boolean;
  send(message: RenderedMessage): Promise<void>;
}

/** Acesso à fila. Implementação real: supabase-store.ts. */
export interface OutboxStore {
  claim(limit: number): Promise<OutboxRow[]>;
  markSent(id: string): Promise<void>;
  markFailed(id: string, error: string, retryable: boolean): Promise<void>;
}

export interface ProcessSummary {
  claimed: number;
  sent: number;
  /** falhou mas vai tentar de novo */
  retrying: number;
  /** esgotou tentativas ou erro permanente */
  failed: number;
  /** canal sem configuração: nada foi reivindicado */
  notConfigured?: boolean;
}
