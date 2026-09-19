"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/lib/auth/session";
import { isAdmin } from "@/lib/roles";
import { friendlyRpcError } from "@/lib/sales/errors";
import { processNotifications } from "@/lib/notifications";
import { TelegramChannel } from "@/lib/notifications/telegram";
import { EVENT_TYPES } from "@/lib/notifications/types";

export type SettingsState = { error?: string; ok?: boolean } | null;
export type ToolResult = { ok: boolean; message: string };

async function requireAdminCtx() {
  const ctx = await requireEmployee();
  if (!isAdmin(ctx.employee.role)) throw new Error("Apenas administradores podem alterar as configurações.");
  return ctx;
}

const percent = (raw: FormDataEntryValue | null, label: string): number | string => {
  const n = Number(String(raw ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 100) return `${label}: informe um percentual entre 0 e 100.`;
  return n;
};

export async function saveSettings(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const { supabase, employee } = await requireAdminCtx();

  const discountSeller = percent(formData.get("discount_limit_percent_vendedor"), "Desconto do vendedor");
  const discountManager = percent(formData.get("discount_limit_percent_gerente"), "Desconto do gerente");
  const maxInterest = percent(formData.get("max_interest_percent"), "Juros máximo");
  for (const v of [discountSeller, discountManager, maxInterest]) if (typeof v === "string") return { error: v };

  const events = formData.getAll("events").map(String).filter((e) => (EVENT_TYPES as readonly string[]).includes(e));

  const now = new Date().toISOString();
  const rows = [
    { key: "discount_limit_percent_vendedor", value: discountSeller },
    { key: "discount_limit_percent_gerente", value: discountManager },
    { key: "max_interest_percent", value: maxInterest },
    { key: "notify_events", value: events },
  ].map((r) => ({ ...r, updated_by: employee.id, updated_at: now }));

  const { error } = await supabase.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return { error: error.code === "42501" ? "Sem permissão para alterar configurações." : error.message };

  revalidatePath("/configuracoes");
  return { ok: true };
}

/** Envia uma mensagem de teste direto ao Telegram do CEO (confirma token e chat ID). */
export async function sendTestNotificationAction(): Promise<ToolResult> {
  await requireAdminCtx();
  const channel = TelegramChannel.fromEnv();
  if (!channel.isConfigured()) {
    return { ok: false, message: "Faltam TELEGRAM_BOT_TOKEN e/ou TELEGRAM_CEO_CHAT_ID nas variáveis de ambiente." };
  }
  try {
    await channel.send({ text: "<b>✅ Teste de notificação</b>\n\nSe você recebeu esta mensagem, o Telegram está configurado corretamente. As vendas e alertas de estoque chegarão aqui.", parseMode: "HTML" });
    return { ok: true, message: "Mensagem de teste enviada. Confira o Telegram." };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

/** Entrega agora o que estiver pendente na fila. */
export async function processQueueNowAction(): Promise<ToolResult> {
  await requireAdminCtx();
  const r = await processNotifications(25);
  revalidatePath("/configuracoes");
  if ("error" in r) return { ok: false, message: r.error };
  if (r.notConfigured) return { ok: false, message: "Telegram não configurado: a fila continua pendente." };
  return { ok: true, message: `${r.sent} enviada(s), ${r.retrying} para tentar de novo, ${r.failed} com falha.` };
}

export async function retryNotificationAction(id: string): Promise<ToolResult> {
  const { supabase } = await requireAdminCtx();
  const { error } = await supabase.rpc("notification_retry", { p_id: id });
  if (error) return { ok: false, message: friendlyRpcError(error) };
  after(async () => {
    await processNotifications();
  });
  revalidatePath("/configuracoes");
  return { ok: true, message: "Reenvio agendado." };
}
