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

export async function updateEmployeeTelegramChatId(
  employeeId: string,
  _prev: EmployeeActionState,
  formData: FormData
): Promise<EmployeeActionState> {
  const { supabase } = await requireAdminAction();
  const raw = String(formData.get("telegram_chat_id") ?? "").trim();
  if (raw && !/^-?\d+$/.test(raw)) return { error: "O chat ID é só números (o bot informa isso no /start)." };

  const { error } = await supabase
    .from("employees")
    .update({ telegram_chat_id: raw || null })
    .eq("id", employeeId);
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

/** Corrige o nome de exibição (o do e-mail vira "vendedor duplicado" nos filtros). Só admin/ceo; o banco também confere. */
export async function updateEmployeeName(
  employeeId: string,
  _prev: EmployeeActionState,
  formData: FormData
): Promise<EmployeeActionState> {
  const { supabase } = await requireAdminAction();
  const name = String(formData.get("full_name") ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) return { error: "Informe o nome da pessoa." };
  if (name.includes("@")) return { error: "O nome não pode ser um e-mail." };

  const { error } = await supabase.from("employees").update({ full_name: name }).eq("id", employeeId);
  if (error) return { error: error.code === "42501" ? "Sem permissão." : error.code === "23514" ? "Nome inválido." : error.message };

  revalidatePath("/funcionarios");
  revalidatePath("/vendas");
  return { ok: true };
}
