import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { SaleStatusBadge, SALE_STATUS_LABEL } from "@/components/sales/SaleStatusBadge";
import { resolvePeriod } from "@/lib/dates";
import { PAYMENT_LABEL, PAYMENT_METHODS, type PaymentMethod } from "@/lib/sales/pricing";
import { escapeLike, formatCurrency, formatDate } from "@/lib/utils";
import type { SaleStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

interface Params {
  q?: string;
  status?: string;
  metodo?: string;
  vendedor?: string;
  de?: string;
  ate?: string;
  pagina?: string;
}

interface Row {
  id: string;
  number: number;
  status: SaleStatus;
  total: number;
  created_at: string;
  seller: { full_name: string } | null;
  customer: { name: string } | null;
  sale_payments: { method: PaymentMethod; installments: number; card_brand: string | null }[];
  sale_items: { item_name: string; quantity: number }[];
}

export default async function VendasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { supabase, employee } = await requireEmployee();
  const p = await searchParams;
  const manager = isManager(employee.role);
  const page = parsePage(p.pagina);
  const q = (p.q ?? "").trim().slice(0, 80);
  const status = p.status && p.status in SALE_STATUS_LABEL ? p.status : "";
  const metodo = p.metodo && (PAYMENT_METHODS as readonly string[]).includes(p.metodo) ? p.metodo : "";
  const vendedor = manager && /^[0-9a-f-]{36}$/i.test(p.vendedor ?? "") ? p.vendedor! : "";

  const paymentsEmbed = `sale_payments${metodo ? "!inner" : ""}(method, installments, card_brand)`;
  let query = supabase
    .from("sales")
    .select(
      `id, number, status, total, created_at, seller:employees!sales_seller_id_fkey(full_name), customer:customers(name), ${paymentsEmbed}, sale_items(item_name, quantity)`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (metodo) query = query.eq("sale_payments.method", metodo);
  if (vendedor) query = query.eq("seller_id", vendedor);
  if (p.de && p.ate) {
    const range = resolvePeriod("custom", { from: p.de, to: p.ate });
    query = query.gte("created_at", range.from.toISOString()).lt("created_at", range.to.toISOString());
  }

  if (q) {
    // Busca em uma caixa só: código da venda (#VND-000123 / 123), cliente ou produto.
    const codeMatch = /^#?(?:vnd-?)?0*(\d{1,9})$/i.exec(q);
    if (codeMatch) {
      query = query.eq("number", Number(codeMatch[1]));
    } else {
      const term = `%${escapeLike(q.replace(/[(),"]/g, " ").trim())}%`;
      const [{ data: customers }, { data: itemRows }] = await Promise.all([
        supabase.from("customers").select("id").ilike("name", term).limit(100),
        supabase.from("sale_items").select("sale_id").ilike("item_name", term).limit(300),
      ]);
      const customerIds = (customers ?? []).map((c) => c.id);
      const saleIds = [...new Set((itemRows ?? []).map((r) => r.sale_id))];
      const parts = [customerIds.length ? `customer_id.in.(${customerIds.join(",")})` : null, saleIds.length ? `id.in.(${saleIds.join(",")})` : null].filter(Boolean);
      query = parts.length ? query.or(parts.join(",")) : query.eq("id", ZERO_UUID);
    }
  }

  const [{ data: sales, count, error }, { data: employees }] = await Promise.all([
    query.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    manager ? supabase.from("employees").select("id, full_name").order("full_name") : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  if (error) console.error(`[vendas] erro: code=${error.code} message=${error.message}`);

  const rows = (sales as unknown as Row[]) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">{manager ? "Vendas" : "Minhas vendas"}</h1>
        <Link href="/vendas/nova" className="btn-primary">
          <Plus size={16} />
          Nova venda
        </Link>
      </div>

      <form method="get" className="card grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="relative sm:col-span-2">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} className="input pl-9" placeholder="Código, cliente ou produto" />
        </div>
        <select name="status" defaultValue={status} className="input" aria-label="Status">
          <option value="">Todos os status</option>
          {(Object.keys(SALE_STATUS_LABEL) as SaleStatus[]).map((s) => (
            <option key={s} value={s}>
              {SALE_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="metodo" defaultValue={metodo} className="input" aria-label="Forma de pagamento">
          <option value="">Todos os pagamentos</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_LABEL[m]}
            </option>
          ))}
        </select>
        {manager && (
          <select name="vendedor" defaultValue={vendedor} className="input" aria-label="Vendedor">
            <option value="">Todos os vendedores</option>
            {(employees ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-2 sm:col-span-2">
          <input type="date" name="de" defaultValue={p.de ?? ""} className="input" aria-label="De" />
          <span className="text-muted">a</span>
          <input type="date" name="ate" defaultValue={p.ate ?? ""} className="input" aria-label="Até" />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="btn-primary flex-1">
            Filtrar
          </button>
          <Link href="/vendas" className="btn-secondary">
            Limpar
          </Link>
        </div>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-3">Venda</th>
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Cliente</th>
              {manager && <th className="px-4 py-3">Vendedor</th>}
              <th className="px-4 py-3">Produtos</th>
              <th className="px-4 py-3">Pagamento</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => {
              const pay = s.sale_payments[0];
              const first = s.sale_items.slice(0, 2).map((i) => `${i.item_name}${Number(i.quantity) !== 1 ? ` ×${Number(i.quantity)}` : ""}`);
              const more = s.sale_items.length - 2;
              return (
                <tr key={s.id} className="border-b border-border transition-colors last:border-0 hover:bg-foreground/[0.04]">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    <Link href={`/vendas/${s.id}`} className="text-accent hover:underline">
                      #VND-{String(s.number).padStart(6, "0")}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(s.created_at, true)}</td>
                  <td className="px-4 py-3 text-muted">{s.customer?.name ?? "—"}</td>
                  {manager && <td className="px-4 py-3 text-muted">{s.seller?.full_name ?? "—"}</td>}
                  <td className="max-w-[240px] truncate px-4 py-3">
                    {first.join(", ")}
                    {more > 0 && <span className="text-muted"> +{more}</span>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">
                    {pay ? `${PAYMENT_LABEL[pay.method]}${pay.installments > 1 ? ` ${pay.installments}x` : ""}` : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-foreground">{formatCurrency(Number(s.total))}</td>
                  <td className="px-4 py-3">
                    <SaleStatusBadge status={s.status} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={manager ? 8 : 7} className="px-4 py-10 text-center text-muted">
                  Nenhuma venda encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={PAGE_SIZE}
        total={count ?? 0}
        basePath="/vendas"
        params={{ q: q || undefined, status: status || undefined, metodo: metodo || undefined, vendedor: vendedor || undefined, de: p.de, ate: p.ate }}
      />
    </div>
  );
}
