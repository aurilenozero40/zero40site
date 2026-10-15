import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { NotificationService } from "./service";
import { TelegramChannel } from "./telegram";
import type { OutboxRow, OutboxStore, ProcessSummary } from "./types";

/** Fila no Postgres (funções notification_claim / mark_sent / mark_failed — só service_role). */
export function createSupabaseOutboxStore(admin: SupabaseClient): OutboxStore {
  return {
    async claim(limit) {
      const { data, error } = await admin.rpc("notification_claim", { p_limit: limit });
      if (error) throw new Error(`notification_claim: ${error.message}`);
      return (data ?? []) as OutboxRow[];
    },
    async markSent(id) {
      const { error } = await admin.rpc("notification_mark_sent", { p_id: id });
      if (error) throw new Error(`notification_mark_sent: ${error.message}`);
    },
    async markFailed(id, message, retryable) {
      const { error } = await admin.rpc("notification_mark_failed", { p_id: id, p_error: message, p_retryable: retryable });
      if (error) throw new Error(`notification_mark_failed: ${error.message}`);
    },
  };
}

/** Dono + gerentes/admins ativos que já cadastraram seu chat ID (/start no bot). */
async function getTelegramRecipients(admin: SupabaseClient): Promise<string[]> {
  const { data, error } = await admin
    .from("employees")
    .select("telegram_chat_id")
    .eq("active", true)
    .in("role", ["ceo", "admin", "gerente"])
    .not("telegram_chat_id", "is", null);
  if (error) throw new Error(`employees (telegram_chat_id): ${error.message}`);
  return (data ?? [])
    .map((row) => row.telegram_chat_id as string | null)
    .filter((id): id is string => Boolean(id && id.trim()));
}

/** Canal Telegram com os destinatários reais (dono + gerentes/admins ativos). */
export function createTelegramChannel(admin: SupabaseClient = createAdminClient()) {
  return new TelegramChannel({
    token: process.env.TELEGRAM_BOT_TOKEN,
    getRecipients: () => getTelegramRecipients(admin),
  });
}

export function createNotificationService() {
  const admin = createAdminClient();
  return new NotificationService(createSupabaseOutboxStore(admin), {
    telegram: createTelegramChannel(admin),
  });
}

/**
 * Entrega o que estiver pendente na fila. Nunca lança: chamada logo após uma venda (via after())
 * não pode derrubar nem atrasar a resposta — o que falhar fica na fila para o próximo retry.
 */
export async function processNotifications(limit = 10): Promise<ProcessSummary | { error: string }> {
  try {
    return await createNotificationService().processPending(limit);
  } catch (err) {
    console.error("[notificacoes] processamento falhou", err);
    return { error: (err as Error).message };
  }
}
