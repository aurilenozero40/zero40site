"use server";

import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const NOT_ALLOWED = "Apenas gerente, administrador ou CEO podem mexer em kits.";

export async function createKitAction(input: {
  name: string;
  kitPrice: number;
  items: { itemId: string; quantity: number }[];
}): Promise<ActionResult> {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) return { ok: false, error: NOT_ALLOWED };

  const name = input.name.trim();
  if (!name) return { ok: false, error: "Informe o nome do kit." };
  if (!Number.isFinite(input.kitPrice) || input.kitPrice < 0) return { ok: false, error: "Informe o preço do kit." };
  if (!input.items || input.items.length < 2) return { ok: false, error: "Um kit precisa de pelo menos 2 produtos." };
  if (input.items.some((i) => !i.itemId || i.quantity <= 0)) return { ok: false, error: "Quantidade inválida num dos produtos do kit." };

  const { error } = await supabase.from("kits").insert({
    name,
    kit_price: input.kitPrice,
    items: input.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/itens/kits");
  revalidatePath("/vendas/nova");
  return { ok: true, data: undefined };
}

/** Desativa/reativa um kit (nada é apagado). */
export async function toggleKitActiveAction(kitId: string, active: boolean): Promise<void> {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) throw new Error(NOT_ALLOWED);

  const { error } = await supabase.from("kits").update({ active, updated_at: new Date().toISOString() }).eq("id", kitId);
  if (error) throw new Error(error.message);

  revalidatePath("/itens/kits");
  revalidatePath("/vendas/nova");
}
