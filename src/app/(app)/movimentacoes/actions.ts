"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { processNotifications } from "@/lib/notifications";
import { movementSchema } from "@/lib/validations";

export type ActionState = { error?: string } | null;

function parseFormData(formData: FormData) {
  const type = formData.get("type");
  const base = {
    type,
    item_id: formData.get("item_id"),
    quantity: formData.get("quantity"),
  };

  if (type === "entrada" || type === "saida") {
    return {
      ...base,
      subtype: formData.get("subtype"),
      unit_value: formData.get("unit_value") === "" ? "" : Number(formData.get("unit_value")),
      reason: formData.get("reason"),
    };
  }

  return {
    ...base,
    adjustment_increases_stock: formData.get("direction") === "aumenta",
    reason: formData.get("reason"),
  };
}

/**
 * Movimentação MANUAL de estoque (entrada, perda, ajuste…). Venda não passa por aqui: nasce no PDV.
 * O banco também recusa venda/cancelamento lançados à mão e qualquer quem não seja gerente+.
 */
export async function createMovement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) {
    return { error: "Apenas gerente, administrador ou CEO podem lançar movimentações de estoque." };
  }

  const parsed = movementSchema.safeParse(parseFormData(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Confere o estoque ANTES de tentar: mensagem clara e valor mais atual possível. O banco também
  // barra estoque negativo (items_quantity_not_negative) e trava a linha do produto.
  const isStockDecrease =
    parsed.data.type === "saida" || (parsed.data.type === "ajuste" && !parsed.data.adjustment_increases_stock);

  if (isStockDecrease) {
    const { data: currentItem } = await supabase
      .from("items")
      .select("name, quantity, unit")
      .eq("id", parsed.data.item_id)
      .single();

    if (currentItem && Number(currentItem.quantity) - parsed.data.quantity < 0) {
      return {
        error: `Estoque insuficiente: ${currentItem.name} tem só ${currentItem.quantity} ${currentItem.unit} disponível, e essa movimentação tiraria ${parsed.data.quantity} ${currentItem.unit}.`,
      };
    }
  }

  // Perda tem que vir com motivo escrito — sustenta auditoria (por que sumiu/quebrou).
  if (parsed.data.type === "saida" && parsed.data.subtype === "perda" && !parsed.data.reason) {
    return { error: "Motivo da perda é obrigatório" };
  }

  const { error } = await supabase.from("movements").insert({
    ...parsed.data,
    source_channel: "web",
  });

  if (error) {
    if (error.message.includes("items_quantity_not_negative")) {
      return { error: "Essa movimentação deixaria o estoque negativo. Confira a quantidade disponível do item." };
    }
    if (error.code === "42501") return { error: "Você não tem permissão para lançar movimentações." };
    return { error: error.message };
  }

  revalidatePath("/movimentacoes");
  revalidatePath("/itens");
  revalidatePath(`/itens/${parsed.data.item_id}`);
  revalidatePath("/dashboard");
  revalidatePath("/relatorios/entradas");
  revalidatePath("/relatorios/saidas");
  // estoque baixo/esgotado pode ter virado evento: entrega sem atrasar a resposta
  after(async () => {
    await processNotifications();
  });
  redirect("/movimentacoes");
}
