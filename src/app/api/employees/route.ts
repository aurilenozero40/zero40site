import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAdmin, isRole } from "@/lib/roles";

export async function POST(request: NextRequest) {
  // Esta rota usa a chave de serviço (ignora RLS): a checagem de admin aqui é a única barreira.
  const { user, employee } = await getSession();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }
  if (!employee || !isAdmin(employee.role)) {
    return NextResponse.json({ error: "Apenas administradores podem criar funcionários" }, { status: 403 });
  }

  let body: { full_name?: string; email?: string; password?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida" }, { status: 400 });
  }
  const { full_name, email, password } = body;
  const role = body.role ?? "vendedor";

  if (!full_name?.trim() || !email?.trim() || !password) {
    return NextResponse.json({ error: "Nome, e-mail e senha são obrigatórios" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Senha deve ter ao menos 6 caracteres" }, { status: 400 });
  }
  if (!isRole(role)) {
    return NextResponse.json({ error: "Papel inválido" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name.trim() },
  });

  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Erro ao criar funcionário" }, { status: 400 });
  }

  // O trigger do banco cria a linha em employees como 'vendedor'; ajusta se pediram outro papel.
  if (role !== "vendedor") {
    const { error: roleError } = await admin.from("employees").update({ role }).eq("id", created.user.id);
    if (roleError) {
      return NextResponse.json(
        { error: `Funcionário criado, mas não foi possível definir o papel: ${roleError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ id: created.user.id, full_name: full_name.trim(), email: email.trim(), role });
}
