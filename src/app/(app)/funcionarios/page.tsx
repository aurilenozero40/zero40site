import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import type { Employee } from "@/lib/types";
import { updateTelegramChatId, toggleEmployeeActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function FuncionariosPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: caller } = await supabase
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .single();

  if (caller?.role !== "admin") {
    redirect("/dashboard");
  }

  const { data: employees, error } = await supabase
    .from("employees")
    .select("*")
    .order("full_name");

  if (error)
    console.error(
      `[funcionarios] erro ao buscar employees: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Funcionários</h1>
        <Link href="/funcionarios/novo" className="btn-primary">
          <Plus size={16} />
          Novo funcionário
        </Link>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3">Telegram chat ID</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {((employees as Employee[]) ?? []).map((emp) => {
              const boundUpdateTelegram = updateTelegramChatId.bind(null, emp.id);
              const boundToggleActive = toggleEmployeeActive.bind(null, emp.id, !emp.active);
              return (
                <tr key={emp.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">{emp.full_name}</td>
                  <td className="px-4 py-3 capitalize text-muted">{emp.role}</td>
                  <td className="px-4 py-3">
                    <form action={boundUpdateTelegram} className="flex items-center gap-2">
                      <input
                        name="telegram_chat_id"
                        defaultValue={emp.telegram_chat_id ?? ""}
                        placeholder="não vinculado"
                        className="input h-8 w-36 text-xs"
                      />
                      <button type="submit" className="btn-secondary h-8 px-2 text-xs">
                        Salvar
                      </button>
                    </form>
                  </td>
                  <td className="px-4 py-3">
                    <form action={boundToggleActive}>
                      <button
                        type="submit"
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          emp.active ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
                        }`}
                      >
                        {emp.active ? "Ativo" : "Inativo"}
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        Para vincular o Telegram, peça ao funcionário para enviar /start ao bot e repassar o chat
        ID retornado.
      </p>
    </div>
  );
}
