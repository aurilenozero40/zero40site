"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { itemSchema } from "@/lib/validations";

function parseFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    sku: formData.get("sku"),
    barcode: formData.get("barcode"),
    category: formData.get("category"),
    subcategory: formData.get("subcategory"),
    manufacturer: formData.get("manufacturer"),
    unit: formData.get("unit") || "un",
    cost_price: formData.get("cost_price") === "" ? "" : Number(formData.get("cost_price")),
    sale_price: formData.get("sale_price") === "" ? "" : Number(formData.get("sale_price")),
    min_stock: formData.get("min_stock"),
    reorder_point:
      formData.get("reorder_point") === "" ? "" : Number(formData.get("reorder_point")),
    max_stock: formData.get("max_stock") === "" ? "" : Number(formData.get("max_stock")),
    location: formData.get("location") || "principal",
    supplier_id: formData.get("supplier_id"),
  };
}

export type ActionState = { error?: string } | null;

export async function createItem(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = itemSchema.safeParse(parseFormData(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("items").insert(parsed.data);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/itens");
  redirect("/itens");
}

export async function updateItem(
  itemId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = itemSchema.safeParse(parseFormData(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("items")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", itemId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/itens");
  revalidatePath(`/itens/${itemId}`);
  redirect(`/itens/${itemId}`);
}

export async function toggleItemActive(itemId: string, active: boolean) {
  const supabase = await createClient();
  await supabase.from("items").update({ active }).eq("id", itemId);
  revalidatePath("/itens");
}
