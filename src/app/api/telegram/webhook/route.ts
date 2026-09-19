import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { TelegramChannel } from "@/lib/notifications/telegram";

/**
 * O Telegram é SÓ camada de notificações: vendas e movimentações nascem na plataforma
 * (com validação, estoque, auditoria e aviso ao CEO). Este webhook existe apenas para o
 * dono descobrir o chat ID que vai em TELEGRAM_CEO_CHAT_ID.
 */

type TelegramUpdate = {
  message?: {
    text?: string;
    chat: { id: number };
  };
};

const safeEqual = (a: string, b: string) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

export async function POST(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const received = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  // sem segredo configurado, ninguém entra (antes, header e env ausentes podiam coincidir)
  if (!expected || !safeEqual(received, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const message = update.message;
  const text = message?.text?.trim();
  // só reage a comandos (/start, /entrada...); conversa solta é ignorada
  if (!message || !text || !text.startsWith("/")) return NextResponse.json({ ok: true });

  const command = text.split(/\s+/)[0].toLowerCase().replace(/^\//, "").split("@")[0];
  const chatId = message.chat.id;

  const reply =
    command === "start"
      ? `Este bot envia os avisos da loja (vendas, cancelamentos, estoque baixo).\n\nO ID deste chat é: ${chatId}\n\nPara receber os avisos aqui, o administrador coloca esse número em TELEGRAM_CEO_CHAT_ID.`
      : "Este bot só envia notificações. Para registrar vendas e movimentações de estoque, use a plataforma.";

  try {
    await TelegramChannel.fromEnv().sendTo(chatId, { text: reply });
  } catch (err) {
    console.error("[telegram/webhook] falha ao responder:", (err as Error).message);
  }

  // sempre 200: erro aqui não pode fazer o Telegram reenviar o mesmo update
  return NextResponse.json({ ok: true });
}
