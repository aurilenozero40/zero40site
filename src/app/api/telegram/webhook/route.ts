import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCommand, HELP_TEXT } from "@/lib/telegram/parseCommand";
import { sendMessage } from "@/lib/telegram/sendMessage";
import { formatQuantity } from "@/lib/utils";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat: { id: number };
  };
};

export async function POST(request: NextRequest) {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const message = update.message;

  if (!message?.text) {
    return NextResponse.json({ ok: true });
  }

  const chatId = message.chat.id;
  const text = message.text;

  try {
    const parsed = parseCommand(text);

    if (!parsed.ok) {
      await sendMessage(chatId, parsed.error);
      return NextResponse.json({ ok: true });
    }

    if (parsed.command.kind === "ajuda") {
      await sendMessage(chatId, HELP_TEXT);
      return NextResponse.json({ ok: true });
    }

    if (parsed.command.kind === "start") {
      await sendMessage(
        chatId,
        `Seu chat ID é ${chatId}. Envie esse número para o administrador vincular sua conta.`
      );
      return NextResponse.json({ ok: true });
    }

    const supabase = createAdminClient();

    const { data: employee } = await supabase
      .from("employees")
      .select("id, full_name")
      .eq("telegram_chat_id", String(chatId))
      .eq("active", true)
      .maybeSingle();

    if (!employee) {
      await sendMessage(
        chatId,
        "Chat não vinculado a um funcionário. Peça ao administrador para vincular seu Telegram (envie /start e repasse o chat ID)."
      );
      return NextResponse.json({ ok: true });
    }

    const { data: item } = await supabase
      .from("items")
      .select("id, name, sku, unit, quantity, min_stock")
      .ilike("sku", parsed.command.sku)
      .eq("active", true)
      .maybeSingle();

    if (!item) {
      await sendMessage(chatId, `Item com SKU "${parsed.command.sku}" não encontrado.`);
      return NextResponse.json({ ok: true });
    }

    if (parsed.command.kind === "saldo") {
      await sendMessage(
        chatId,
        `${item.name}: ${formatQuantity(item.quantity, item.unit)} (mínimo ${formatQuantity(item.min_stock, item.unit)})`
      );
      return NextResponse.json({ ok: true });
    }

    const baseRow = {
      item_id: item.id,
      created_by: employee.id,
      source_channel: "telegram" as const,
    };

    // Mesma trava de estoque do formulário web — confere ANTES de tentar
    // inserir (o banco também tem a constraint items_quantity_not_negative
    // como rede de segurança final).
    const isStockDecrease =
      parsed.command.kind === "saida" ||
      (parsed.command.kind === "ajuste" && !parsed.command.increases);

    if (isStockDecrease && item.quantity - parsed.command.quantity < 0) {
      await sendMessage(
        chatId,
        `Estoque insuficiente: ${item.name} tem só ${formatQuantity(item.quantity, item.unit)} disponível.`
      );
      return NextResponse.json({ ok: true });
    }

    let insertError: string | null = null;

    if (parsed.command.kind === "entrada" || parsed.command.kind === "saida") {
      const { error } = await supabase.from("movements").insert({
        ...baseRow,
        type: parsed.command.kind,
        quantity: parsed.command.quantity,
        unit_value: parsed.command.unitValue,
        reason: parsed.command.reason,
      });
      insertError = error?.message ?? null;
    } else if (parsed.command.kind === "ajuste") {
      const { error } = await supabase.from("movements").insert({
        ...baseRow,
        type: "ajuste",
        quantity: parsed.command.quantity,
        adjustment_increases_stock: parsed.command.increases,
        reason: parsed.command.reason,
      });
      insertError = error?.message ?? null;
    }

    if (insertError) {
      const friendly = insertError.includes("items_quantity_not_negative")
        ? `Estoque insuficiente pra essa movimentação de ${item.name}.`
        : `Erro ao registrar movimentação: ${insertError}`;
      await sendMessage(chatId, friendly);
      return NextResponse.json({ ok: true });
    }

    revalidatePath("/movimentacoes");
    revalidatePath("/itens");
    revalidatePath(`/itens/${item.id}`);
    revalidatePath("/dashboard");
    revalidatePath("/relatorios/entradas");
    revalidatePath("/relatorios/saidas");

    const { data: updatedItem } = await supabase
      .from("items")
      .select("quantity, unit")
      .eq("id", item.id)
      .single();

    await sendMessage(
      chatId,
      `OK — ${item.name}: novo saldo ${formatQuantity(updatedItem?.quantity ?? item.quantity, item.unit)}.`
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    try {
      await sendMessage(chatId, "Ocorreu um erro ao processar seu comando. Tente novamente.");
    } catch {
      // ignore secondary failure
    }
    console.error("telegram webhook error", err);
    return NextResponse.json({ ok: true });
  }
}
