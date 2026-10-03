"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { itemSchema } from "@/lib/validations";
import type { Item } from "@/lib/types";

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
    warranty_months: formData.get("warranty_months") === "" ? "" : Number(formData.get("warranty_months")),
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

  const rawSerials = formData.get("initial_serials");
  const initialSerials: string[] =
    typeof rawSerials === "string" && rawSerials.trim() !== "" ? JSON.parse(rawSerials) : [];

  // Estoque inicial normalmente NÃO entra pelo cadastro (sempre por uma Entrada, fica no histórico) —
  // exceto quando já tem o(s) serial(is) em mãos: aí dá entrada junto, pra não precisar trocar de tela.
  const { data: newItem, error } = await supabase.from("items").insert(parsed.data).select("id").single();

  if (error) {
    return { error: friendlyItemError(error) };
  }

  let warning = "";
  if (initialSerials.length > 0) {
    const { error: moveError } = await supabase.rpc("create_movement", {
      p_type: "entrada",
      p_item_id: newItem.id,
      p_quantity: null,
      p_subtype: "outros",
      p_unit_value: null,
      p_reason: "Cadastro inicial do produto",
      p_adjustment_increases_stock: null,
      p_serials: initialSerials,
      p_supplier_id: null,
    });
    if (moveError) warning = `?aviso=${encodeURIComponent(friendlyItemError(moveError))}`;
  }

  revalidatePath("/itens");
  revalidatePath("/movimentacoes");
  redirect(`/itens/${newItem.id}${warning}`);
}

export type QuickItemResult = { ok: true; data: Item } | { ok: false; error: string };

/**
 * Cadastro rápido de produto direto da entrada de estoque: bipou um código de barras que
 * ainda não existe? Cadastra ali mesmo (nome, SKU, preço, se usa serial) sem trocar de tela.
 */
export async function createItemQuickAction(input: {
  name: string;
  sku?: string | null;
  barcode?: string | null;
  salePrice?: number | null;
  trackSerial?: boolean;
}): Promise<QuickItemResult> {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) {
    return { ok: false, error: "Apenas gerente, administrador ou CEO podem cadastrar produtos." };
  }
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Informe o nome do produto." };

  const { data, error } = await supabase
    .from("items")
    .insert({
      name,
      sku: input.sku?.trim() || null,
      barcode: input.barcode?.trim() || null,
      sale_price: input.salePrice ?? null,
      track_serial: input.trackSerial ?? false,
    })
    .select("*")
    .single();

  if (error) {
    return { ok: false, error: friendlyItemError(error) };
  }

  revalidatePath("/itens");
  return { ok: true, data: data as Item };
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
