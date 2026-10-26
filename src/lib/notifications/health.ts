import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface NotificationHealth {
  hasToken: boolean;
  recipients: number;
  failed: number;
  /** true quando os avisos (Telegram) vão chegar de verdade */
  ok: boolean;
  /** frase pronta para mostrar na tela quando !ok */
  problem: string | null;
}

/**
 * Diagnóstico do canal de avisos. Só LEITURA: serve para a tela avisar, de forma visível, que o
 * "aviso ao CEO" não está funcionando. A venda nunca depende disso (fila + retry no banco).
 */
export async function getNotificationHealth(supabase: SupabaseClient): Promise<NotificationHealth> {
  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);

  let recipients = 0;
  let failed = 0;
  try {
    const [{ count: rc }, { count: fc }] = await Promise.all([
      supabase
        .from("employees")
        .select("id", { count: "exact", head: true })
        .eq("active", true)
        .in("role", ["ceo", "admin", "gerente"])
        .not("telegram_chat_id", "is", null),
      supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "failed"),
    ]);
    recipients = rc ?? 0;
    failed = fc ?? 0;
  } catch (err) {
    console.error("[notificacoes] diagnóstico falhou:", (err as Error).message);
  }

  let problem: string | null = null;
  if (!hasToken && recipients === 0) problem = "O Telegram não está configurado (falta o token do bot e nenhum destinatário tem chat ID).";
  else if (!hasToken) problem = "Falta TELEGRAM_BOT_TOKEN: nenhum aviso está sendo enviado.";
  else if (recipients === 0) problem = "Nenhum destinatário com chat ID do Telegram em Funcionários: ninguém recebe os avisos.";
  else if (failed > 0) problem = `${failed} aviso(s) falharam no envio e aguardam reenvio.`;

  return { hasToken, recipients, failed, ok: problem === null, problem };
}
