import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getSession } from "@/lib/auth/session";
import { processNotifications } from "@/lib/notifications";
import { isAdmin } from "@/lib/roles";

export const dynamic = "force-dynamic";

const digest = (v: string) => createHash("sha256").update(v).digest();

/**
 * Entrega o que estiver pendente na fila de notificações (reenvio de falhas).
 * Chamada por um agendador externo (Vercel Cron / Supabase pg_cron) com
 *   Authorization: Bearer <CRON_SECRET>
 * ou por um admin logado. Falha de Telegram nunca afeta vendas: aqui só se reenvia.
 */
async function handle(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";

  let allowed = Boolean(secret) && timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
  if (!allowed) {
    const { employee } = await getSession();
    allowed = Boolean(employee && isAdmin(employee.role));
  }
  if (!allowed) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  return NextResponse.json(await processNotifications(25));
}

export const GET = handle; // Vercel Cron chama com GET
export const POST = handle;
