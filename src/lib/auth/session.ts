import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, isManager, isRole, type Role } from "@/lib/roles";

export interface SessionEmployee {
  id: string;
  email: string | null;
  fullName: string;
  role: Role;
}

/**
 * Sessão da requisição: cliente Supabase + usuário logado + funcionário (papel).
 * Memoizada por requisição (React cache): layout e página compartilham a mesma consulta.
 * O papel aqui só decide o que MOSTRAR — quem impõe a permissão é o banco (RLS + funções).
 */
export const getSession = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, employee: null as SessionEmployee | null };

  const { data } = await supabase.from("employees").select("full_name, role, active").eq("id", user.id).single();

  // Usuário sem linha em employees, inativo ou com papel desconhecido: logado, mas sem acesso.
  if (!data || !data.active || !isRole(data.role)) {
    return { supabase, user, employee: null as SessionEmployee | null };
  }

  const employee: SessionEmployee = {
    id: user.id,
    email: user.email ?? null,
    fullName: data.full_name,
    role: data.role,
  };
  return { supabase, user, employee };
});

/**
 * Exige um funcionário ativo. Sem login → /login. Logado mas sem acesso → /sem-acesso
 * (não pode ser /login: o proxy devolveria para o painel e daria loop).
 */
export async function requireEmployee() {
  const session = await getSession();
  if (!session.user) redirect("/login");
  if (!session.employee) redirect("/sem-acesso");
  return { supabase: session.supabase, employee: session.employee };
}

/** Exige gerente, admin ou CEO (senão volta ao painel). */
export async function requireManager() {
  const ctx = await requireEmployee();
  if (!isManager(ctx.employee.role)) redirect("/dashboard");
  return ctx;
}

/** Exige admin ou CEO (senão volta ao painel). */
export async function requireAdmin() {
  const ctx = await requireEmployee();
  if (!isAdmin(ctx.employee.role)) redirect("/dashboard");
  return ctx;
}
