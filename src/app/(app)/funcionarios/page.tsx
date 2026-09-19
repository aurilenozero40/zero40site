import Link from "next/link";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { EmployeeRoleForm } from "@/components/employees/EmployeeRoleForm";
import type { Employee } from "@/lib/types";
import { toggleEmployeeActive } from "./actions";

export const dynamic = "force-dynamic";

export default async function FuncionariosPage() {
  const { supabase, employee: me } = await requireAdmin();

  const { data: employees, error } = await supabase.from("employees").select("*").order("full_name");

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
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Papel</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {((employees as Employee[]) ?? []).map((emp) => {
              const isMe = emp.id === me.id;
              const toggle = toggleEmployeeActive.bind(null, emp.id, !emp.active);
              return (
                <tr key={emp.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-medium text-foreground">
                    {emp.full_name}
                    {isMe && <span className="ml-2 text-xs font-normal text-muted">(você)</span>}
                  </td>
                  <td className="px-4 py-3">
                    <EmployeeRoleForm employeeId={emp.id} role={emp.role} />
                  </td>
                  <td className="px-4 py-3">
                    <form action={toggle}>
                      <button
                        type="submit"
                        disabled={isMe}
                        title={isMe ? "Você não pode desativar a si mesmo" : undefined}
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold disabled:opacity-50 ${
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

      <div className="card text-xs text-muted">
        <p className="mb-1 font-medium text-foreground">O que cada papel pode</p>
        <ul className="list-inside list-disc space-y-0.5">
          <li><strong>Vendedor</strong> — registra vendas, cadastra clientes, vê as próprias vendas.</li>
          <li><strong>Gerente</strong> — tudo do vendedor + vê todas as vendas, cancela/devolve, cadastra produto e preço, movimenta estoque, relatórios.</li>
          <li><strong>Administrador e CEO</strong> — tudo do gerente + funcionários, configurações e taxas.</li>
        </ul>
      </div>
    </div>
  );
}
