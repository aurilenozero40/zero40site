import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .single();

  if (caller?.role !== "admin") {
    return NextResponse.json({ error: "Apenas administradores podem criar funcionários" }, { status: 403 });
  }

  const body = await request.json();
  const { full_name, email, password, role } = body as {
    full_name?: string;
    email?: string;
    password?: string;
    role?: "admin" | "staff";
  };

  if (!full_name || !email || !password) {
    return NextResponse.json({ error: "Nome, e-mail e senha são obrigatórios" }, { status: 400 });
  }

  if (password.length < 6) {
    return NextResponse.json({ error: "Senha deve ter ao menos 6 caracteres" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Erro ao criar funcionário" },
      { status: 400 }
    );
  }

  if (role === "admin") {
    await admin.from("employees").update({ role: "admin" }).eq("id", created.user.id);
  }

  return NextResponse.json({ id: created.user.id, full_name, email, role: role ?? "staff" });
}
