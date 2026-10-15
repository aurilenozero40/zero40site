import { NotificationError, type NotificationChannel, type RenderedMessage } from "./types";

export interface TelegramConfig {
  token?: string;
  /** Lista de chat IDs (dono + gerentes/admins). Pode ser assíncrono (consulta ao banco). */
  getRecipients?: () => Promise<string[]>;
  /** injetável para teste */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Canal Telegram. Token vem SEMPRE de variável de ambiente (TELEGRAM_BOT_TOKEN) — nunca no
 * código. Os destinatários (dono + gerentes/admins) vêm de `getRecipients` — cada um tem seu
 * próprio chat ID cadastrado em employees.telegram_chat_id. Erros nunca carregam o token.
 */
export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";
  private readonly token?: string;
  private readonly getRecipients: () => Promise<string[]>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: TelegramConfig) {
    this.token = config.token?.trim() || undefined;
    this.getRecipients = config.getRecipients ?? (async () => []);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch) {
    return new TelegramChannel({ token: env.TELEGRAM_BOT_TOKEN, fetchImpl });
  }

  async isConfigured() {
    if (!this.token) return false;
    const recipients = await this.getRecipients();
    return recipients.length > 0;
  }

  /** Envia para todos os destinatários cadastrados (dono + gerentes/admins). */
  async send(message: RenderedMessage): Promise<void> {
    if (!this.token) {
      throw new NotificationError("Telegram não configurado (TELEGRAM_BOT_TOKEN).", true);
    }
    const recipients = await this.getRecipients();
    if (recipients.length === 0) {
      throw new NotificationError("Telegram sem destinatários (nenhum employee com telegram_chat_id).", true);
    }

    const results = await Promise.allSettled(recipients.map((chatId) => this.sendTo(chatId, message)));
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failures.length === results.length) {
      // ninguém recebeu: propaga o primeiro erro para decidir se vale retry
      throw failures[0].reason;
    }
    // ao menos um destinatário recebeu — considera entregue (os outros falharam por motivo próprio,
    // ex: bot bloqueado por aquele gerente específico, não vale travar a fila por isso)
  }

  /** Envia para um chat específico (usado para destinatários individuais e para o /start do webhook). */
  async sendTo(chatId: string | number, message: RenderedMessage): Promise<void> {
    if (!this.token) {
      throw new NotificationError("Telegram não configurado (TELEGRAM_BOT_TOKEN).", true);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message.text,
          parse_mode: message.parseMode,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      // rede caiu / timeout: vale tentar de novo
      throw new NotificationError(`Falha de rede ao falar com o Telegram: ${this.scrub(err)}`, true);
    }

    if (response.ok) return;

    const body = (await response.json().catch(() => null)) as { description?: string } | null;
    const detail = this.scrub(body?.description ?? response.statusText);
    // 429 (limite) e 5xx passam; 400/401/403/404 (chat errado, bot bloqueado, token ruim) não adianta repetir
    const retryable = response.status === 429 || response.status >= 500;
    throw new NotificationError(`Telegram respondeu ${response.status}: ${detail}`, retryable);
  }

  /** Garante que o token não vaza em mensagens de erro/log. */
  private scrub(err: unknown): string {
    const text = err instanceof Error ? err.message : String(err);
    return this.token ? text.split(this.token).join("***") : text;
  }
}
