"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { processNotifications } from "@/lib/notifications";
import { friendlyRpcError } from "@/lib/sales/errors";
import { movementSchema } from "@/lib/validations";

export type ActionState = { error?: string } | null;

function parseFormData(formData: FormData) {
  const type = formData.get("type");
  const rawSerials = formData.get("serials");
  const serials = typeof rawSerials === "string" && rawSerials.trim() !== "" ? JSON.parse(rawSerials) : undefined;
  const base = {
    type,
    item_id: formData.get("item_id"),
    quantity: formData.get("quantity"),
    serials,
  };

  if (type === "entrada" || type === "saida") {
    return {
      ...base,
      subtype: formData.get("subtype"),
      unit_value: formData.get("unit_value") === "" ? "" : Number(formData.get("unit_value")),
      reason: formData.get("reason"),
      supplier_id: formData.get("supplier_id") || null,
    };
  }

  return {
    ...base,
    adjustment_increases_stock: formData.get("direction") === "aumenta",
    reason: formData.get("reason"),
  };
}

export type SupplierHit = { id: string; name: string };

/** Cadastro rápido de fornecedor direto da tela de movimentação — não precisa ir a outra tela. */
export async function createSupplierQuickAction(name: string): Promise<ActionState & { data?: SupplierHit }> {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) {
    return { error: "Apenas gerente, administrador ou CEO podem cadastrar fornecedores." };
  }
  const trimmed = name.trim();
  if (!trimmed) return { error: "Informe o nome do fornecedor." };

  const { data, error } = await supabase.from("suppliers").insert({ name: trimmed }).select("id, name").single();
  if (error) {
    if (error.code === "23505") return { error: "Já existe um fornecedor com esse nome." };
    return { error: friendlyRpcError(error) };
  }
  revalidatePath("/movimentacoes/nova");
  return { data: data as SupplierHit };
}

/** Números de série ainda em estoque de um item (para saída/ajuste: escolher quais unidades saem). */
export async function listAvailableSerialsAction(itemId: string): Promise<string[]> {
  const { supabase } = await requireEmployee();
  if (!itemId) return [];
  const { data } = await supabase
    .from("item_serials")
    .select("serial")
    .eq("item_id", itemId)
    .eq("status", "estoque")
    .order("created_at");
  return (data ?? []).map((r) => r.serial as string);
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

  const { error } = await supabase.rpc("create_movement", {
    p_type: parsed.data.type,
    p_item_id: parsed.data.item_id,
    p_quantity: parsed.data.quantity,
    p_subtype: "subtype" in parsed.data ? (parsed.data.subtype ?? null) : null,
    p_unit_value: "unit_value" in parsed.data ? (parsed.data.unit_value ?? null) : null,
    p_reason: parsed.data.reason ?? null,
    p_adjustment_increases_stock: "adjustment_increases_stock" in parsed.data ? parsed.data.adjustment_increases_stock : null,
    p_serials: parsed.data.serials && parsed.data.serials.length > 0 ? parsed.data.serials : null,
    p_supplier_id: "supplier_id" in parsed.data ? (parsed.data.supplier_id ?? null) : null,
  });

  if (error) {
    return { error: friendlyRpcError(error) };
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
