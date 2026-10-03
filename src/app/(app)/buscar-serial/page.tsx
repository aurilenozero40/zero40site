import Link from "next/link";
import { Search } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { estoque: "Em estoque", vendido: "Vendido", baixado: "Baixado" };
const STATUS_CLASS: Record<string, string> = {
  estoque: "bg-success/10 text-success",
  vendido: "bg-accent/10 text-accent",
  baixado: "bg-muted/20 text-muted",
};

interface SerialResult {
  id: string;
  serial: string;
  status: string;
  created_at: string;
  sold_at: string | null;
  items: { id: string; name: string; sku: string | null; barcode: string | null } | null;
  sale_items: {
    sale_id: string;
    sales: {
      number: number;
      status: string;
      created_at: string;
      customer: { name: string } | null;
      seller: { full_name: string } | null;
    } | null;
  } | null;
}

/** Busca por número de série/IMEI: acha o produto e, se já foi vendido, a venda e o cliente. */
export default async function BuscarSerialPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { supabase } = await requireEmployee();
  const { q } = await searchParams;
  const term = (q ?? "").trim();

  let results: SerialResult[] = [];
  if (term.length >= 3) {
    const { data } = await supabase
      .from("item_serials")
      .select(
        "id, serial, status, created_at, sold_at, items(id, name, sku, barcode), sale_items(sale_id, sales(number, status, created_at, customer:customers(name), seller:employees!sales_seller_id_fkey(full_name)))"
      )
      .ilike("serial", `%${term}%`)
      .order("created_at", { ascending: false })
      .limit(30);
    results = (data as unknown as SerialResult[]) ?? [];
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Buscar por número de série / IMEI</h1>
        <p className="text-sm text-muted">Achar rápido qual produto é, se já foi vendido, pra quem e quando — útil pra garantia e suporte.</p>
      </div>

      <form method="get" className="relative max-w-md">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          name="q"
          defaultValue={term}
          autoFocus
          className="input pl-9"
          placeholder="Bipe ou digite o número de série (mín. 3 caracteres)"
        />
      </form>

      {term.length > 0 && term.length < 3 && <p className="text-sm text-muted">Digite pelo menos 3 caracteres.</p>}

      {term.length >= 3 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Serial</th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Venda</th>
                <th className="px-4 py-3">Cliente</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const sale = r.sale_items?.sales;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{r.serial}</td>
                    <td className="px-4 py-3">
                      {r.items ? (
                        <Link href={`/itens/${r.items.id}`} className="font-medium text-foreground hover:underline">
                          {r.items.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status] ?? ""}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {sale ? (
                        <Link href={`/vendas/${r.sale_items?.sale_id}`} className="text-accent hover:underline">
                          VND-{String(sale.number).padStart(6, "0")}
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                      {sale && <p className="text-xs text-muted">{formatDate(sale.created_at, true)}</p>}
                    </td>
                    <td className="px-4 py-3 text-muted">{sale?.customer?.name ?? (sale ? "Não informado" : "—")}</td>
                  </tr>
                );
              })}
              {results.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    Nenhum número de série encontrado com &quot;{term}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
