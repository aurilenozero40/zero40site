"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { customerSchema } from "@/lib/validations";

export type ActionState = { error?: string } | null;

function parseFormData(formData: FormData) {
  return {
    name: formData.get("name") ?? "",
    document: formData.get("document") ?? "",
    phone: formData.get("phone") ?? "",
    whatsapp: formData.get("whatsapp") ?? "",
    email: formData.get("email") ?? "",
    address: formData.get("address") ?? "",
    notes: formData.get("notes") ?? "",
  };
}

function friendlyCustomerError(error: { message: string; code?: string }) {
  if (error.code === "23505") return "Já existe um cliente com esse CPF/CNPJ.";
  if (error.code === "42501") return "Você não tem permissão para isso.";
  return error.message;
}

export async function createCustomer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireEmployee();
  const parsed = customerSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { data, error } = await supabase.from("customers").insert(parsed.data).select("id").single();
  if (error) return { error: friendlyCustomerError(error) };

  revalidatePath("/clientes");
  redirect(`/clientes/${data.id}`);
}

export async function updateCustomer(customerId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase } = await requireEmployee();
  const parsed = customerSchema.safeParse(parseFormData(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };

  const { error } = await supabase
    .from("customers")
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq("id", customerId);
  if (error) return { error: friendlyCustomerError(error) };

  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
  redirect(`/clientes/${customerId}`);
}

/** Desativa/reativa (cliente com vendas nunca é apagado). Só gerente+. */
export async function toggleCustomerActive(customerId: string, active: boolean) {
  const { supabase, employee } = await requireEmployee();
  if (!isManager(employee.role)) throw new Error("Sem permissão");
  const { error } = await supabase.from("customers").update({ active, updated_at: new Date().toISOString() }).eq("id", customerId);
  if (error) throw new Error(friendlyCustomerError(error));
  revalidatePath("/clientes");
  revalidatePath(`/clientes/${customerId}`);
}
