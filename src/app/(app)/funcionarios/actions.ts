"use server";

import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/lib/auth/session";
import { isAdmin, isRole } from "@/lib/roles";

export type EmployeeActionState = { error?: string; ok?: boolean } | null;

/** Só admin/ceo. O banco também impõe (RLS) e audita quem mudou o papel de quem. */
async function requireAdminAction() {
  const ctx = await requireEmployee();
  if (!isAdmin(ctx.employee.role)) throw new Error("Apenas administradores podem gerenciar funcionários");
  return ctx;
}

export async function updateEmployeeRole(
  employeeId: string,
  _prev: EmployeeActionState,
  formData: FormData
): Promise<EmployeeActionState> {
  const { supabase, employee } = await requireAdminAction();
  const role = String(formData.get("role") ?? "");

  if (!isRole(role)) return { error: "Papel inválido." };
  // ninguém se rebaixa sozinho: evita deixar a plataforma sem administrador
  if (employeeId === employee.id && !isAdmin(role)) {
    return { error: "Você não pode remover o seu próprio acesso de administrador." };
  }

  const { error } = await supabase.from("employees").update({ role }).eq("id", employeeId);
  if (error) return { error: error.code === "42501" ? "Sem permissão." : error.message };

  revalidatePath("/funcionarios");
  return { ok: true };
}

export async function toggleEmployeeActive(employeeId: string, active: boolean) {
  const { supabase, employee } = await requireAdminAction();
  if (employeeId === employee.id && !active) throw new Error("Você não pode desativar a si mesmo");

  const { error } = await supabase.from("employees").update({ active }).eq("id", employeeId);
  if (error) throw new Error(error.message);
  revalidatePath("/funcionarios");
}
