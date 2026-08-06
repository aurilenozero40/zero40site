"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { movementSchema } from "@/lib/validations";

export type ActionState = { error?: string } | null;

function parseFormData(formData: FormData) {
  const type = formData.get("type");
  const base = {
    type,
    item_id: formData.get("item_id"),
    quantity: formData.get("quantity"),
  };

  if (type === "entrada") {
    return {
      ...base,
      subtype: formData.get("subtype"),
      unit_value: formData.get("unit_value") === "" ? "" : Number(formData.get("unit_value")),
      reason: formData.get("reason"),
    };
  }

  if (type === "saida") {
    return {
      ...base,
      subtype: formData.get("subtype"),
      unit_value: formData.get("unit_value") === "" ? "" : Number(formData.get("unit_value")),
      payment_method: formData.get("payment_method") || null,
      installments:
        formData.get("installments") === "" ? null : Number(formData.get("installments")),
      reason: formData.get("reason"),
    };
  }

  return {
    ...base,
    adjustment_increases_stock: formData.get("direction") === "aumenta",
    reason: formData.get("reason"),
  };
}

export async function createMovement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = movementSchema.safeParse(parseFormData(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("movements").insert({
    ...parsed.data,
    source_channel: "web",
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/movimentacoes");
  revalidatePath("/itens");
  revalidatePath(`/itens/${parsed.data.item_id}`);
  revalidatePath("/dashboard");
  revalidatePath("/relatorios/entradas");
  revalidatePath("/relatorios/saidas");
  redirect("/movimentacoes");
}
