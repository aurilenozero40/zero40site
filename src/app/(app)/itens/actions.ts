"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { itemSchema } from "@/lib/validations";

function parseFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    sku: formData.get("sku"),
    barcode: formData.get("barcode"),
    category: formData.get("category"),
    subcategory: formData.get("subcategory"),
    manufacturer: formData.get("manufacturer"),
    description: formData.get("description") ?? "",
    unit: formData.get("unit") || "un",
    cost_price: formData.get("cost_price") === "" ? "" : Number(formData.get("cost_price")),
    sale_price: formData.get("sale_price") === "" ? "" : Number(formData.get("sale_price")),
    min_stock: formData.get("min_stock"),
    reorder_point:
      formData.get("reorder_point") === "" ? "" : Number(formData.get("reorder_point")),
    max_stock: formData.get("max_stock") === "" ? "" : Number(formData.get("max_stock")),
    location: formData.get("location") || "principal",
    supplier_id: formData.get("supplier_id"),
    track_serial: formData.get("track_serial") === "on",
    condition: formData.get("condition") || "novo",
  };
}

export type ActionState = { error?: string } | null;

// Traduz os erros crus do Postgres que o usuário realmente consegue causar.
function friendlyItemError(error: { message: string; code?: string }) {
  if (error.code === "23505" || error.message.includes("duplicate key")) {
    if (error.message.includes("barcode")) {
      return "Já existe outro item com esse código de barras. Cada produto precisa ter um código diferente.";
    }
    if (error.message.includes("sku")) {
      return "Já existe outro item com esse SKU. Cada produto precisa ter um SKU diferente.";
    }
  }
  if (error.code === "42501") {
    return "Você não tem permissão para cadastrar ou alterar produtos.";
  }
  if (error.message.includes("items_quantity_not_negative")) {
    return "Esse item está com estoque negativo. Registre uma movimentação de Ajuste (aumenta o estoque) pra corrigir a quantidade antes de editar.";
  }
  return error.message;
}

const NOT_ALLOWED: ActionState = { error: "Apenas gerente, administrador ou CEO podem cadastrar e alterar produtos." };

export async function createItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) return NOT_ALLOWED;

  const parsed = itemSchema.safeParse(parseFormData(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Estoque inicial NÃO entra pelo cadastro: sempre por uma Entrada (fica no histórico, com quem/quando).
  const { error } = await supabase.from("items").insert(parsed.data);

  if (error) {
    return { error: friendlyItemError(error) };
  }

  revalidatePath("/itens");
  redirect("/itens");
}

export async function updateItem(
  itemId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) return NOT_ALLOWED;

  const parsed = itemSchema.safeParse(parseFormData(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const { error } = await supabase
    .from("items")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) {
    return { error: friendlyItemError(error) };
  }

  revalidatePath("/itens");
  revalidatePath(`/itens/${itemId}`);
  redirect(`/itens/${itemId}`);
}

/** Desativa/reativa o produto (nada é apagado: histórico e vendas antigas continuam intactos). */
export async function toggleItemActive(itemId: string, active: boolean) {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) throw new Error("Sem permissão");

  const { error } = await supabase.from("items").update({ active, updated_at: new Date().toISOString() }).eq("id", itemId);
  if (error) throw new Error(friendlyItemError(error));

  revalidatePath("/itens");
  revalidatePath(`/itens/${itemId}`);
}
