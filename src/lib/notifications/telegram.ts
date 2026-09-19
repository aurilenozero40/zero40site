import { NotificationError, type NotificationChannel, type RenderedMessage } from "./types";

export interface TelegramConfig {
  token?: string;
  chatId?: string;
  /** injetável para teste */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Canal Telegram. Token e chat ID vêm SEMPRE de variáveis de ambiente (TELEGRAM_BOT_TOKEN e
 * TELEGRAM_CEO_CHAT_ID) — nunca no código. Erros nunca carregam o token.
 */
export class TelegramChannel implements NotificationChannel {
  readonly name = "telegram";
  private readonly token?: string;
  private readonly chatId?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: TelegramConfig) {
    this.token = config.token?.trim() || undefined;
    this.chatId = config.chatId?.trim() || undefined;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  static fromEnv(env: Record<string, string | undefined> = process.env, fetchImpl?: typeof fetch) {
    return new TelegramChannel({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CEO_CHAT_ID, fetchImpl });
  }

  isConfigured() {
    return Boolean(this.token && this.chatId);
  }

  /** Envia para o chat do CEO (TELEGRAM_CEO_CHAT_ID). */
  async send(message: RenderedMessage): Promise<void> {
    if (!this.token || !this.chatId) {
      throw new NotificationError("Telegram não configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CEO_CHAT_ID).", true);
    }
    await this.sendTo(this.chatId, message);
  }

  /** Envia para um chat específico (usado só para responder /start no webhook). */
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
