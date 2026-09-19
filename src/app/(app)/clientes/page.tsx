import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { formatDocument, formatPhone } from "@/lib/documents";
import { escapeLike, formatDate } from "@/lib/utils";
import type { Customer } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ClientesPage({ searchParams }: { searchParams: Promise<{ q?: string; pagina?: string; inativos?: string }> }) {
  const { supabase } = await requireEmployee();
  const params = await searchParams;
  const page = parsePage(params.pagina);
  const q = (params.q ?? "").trim().slice(0, 80);
  const showInactive = params.inativos === "1";

  let query = supabase.from("customers").select("*", { count: "exact" }).order("name");
  if (!showInactive) query = query.eq("active", true);
  if (q) {
    const term = escapeLike(q.replace(/[(),"]/g, " ").trim());
    const digits = q.replace(/\D/g, "");
    query = query.or(
      [`name.ilike.%${term}%`, `email.ilike.%${term}%`, digits.length >= 3 ? `document.like.%${digits}%` : null, digits.length >= 3 ? `phone.like.%${digits}%` : null, digits.length >= 3 ? `whatsapp.like.%${digits}%` : null]
        .filter(Boolean)
        .join(",")
    );
  }

  const { data: customers, count, error } = await query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (error) console.error(`[clientes] erro: code=${error.code} message=${error.message}`);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
        <Link href="/clientes/novo" className="btn-primary">
          <Plus size={16} />
          Novo cliente
        </Link>
      </div>

      <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:max-w-sm sm:flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} className="input pl-9" placeholder="Nome, CPF/CNPJ, telefone ou e-mail" />
        </div>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input type="checkbox" name="inativos" value="1" defaultChecked={showInactive} /> Mostrar inativos
        </label>
        <button type="submit" className="btn-secondary">
          Buscar
        </button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF / CNPJ</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Cadastro</th>
            </tr>
          </thead>
          <tbody>
            {((customers as Customer[]) ?? []).map((c) => (
              <tr key={c.id} className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.04]">
                <td className="px-4 py-3 font-medium text-foreground">
                  <Link href={`/clientes/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                  {!c.active && <span className="ml-2 text-xs font-normal text-muted">(inativo)</span>}
                </td>
                <td className="px-4 py-3 text-muted">{c.document ? formatDocument(c.document) : "—"}</td>
                <td className="px-4 py-3 text-muted">{formatPhone(c.whatsapp ?? c.phone) || "—"}</td>
                <td className="px-4 py-3 text-muted">{c.email ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{formatDate(c.created_at)}</td>
              </tr>
            ))}
            {(customers?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Nenhum cliente encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/clientes" params={{ q: q || undefined, inativos: showInactive ? "1" : undefined }} />
    </div>
  );
}
