import { notFound } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Power } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { isManager } from "@/lib/roles";
import { ItemForm } from "@/components/items/ItemForm";
import { MovementsTable } from "@/components/movements/MovementsTable";
import { formatCurrency, formatDate, formatQuantity } from "@/lib/utils";
import { updateItem, toggleItemActive } from "../actions";
import type { AuditLog, Item, ItemSerial, MovementWithRelations, Supplier } from "@/lib/types";

const SERIAL_STATUS_LABEL: Record<string, string> = { estoque: "Em estoque", vendido: "Vendido", baixado: "Baixado" };
const SERIAL_STATUS_CLASS: Record<string, string> = {
  estoque: "bg-success/10 text-success",
  vendido: "bg-accent/10 text-accent",
  baixado: "bg-muted/20 text-muted",
};

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "item.created": "Produto cadastrado",
  "item.updated": "Produto alterado",
  "item.price_changed": "Preço alterado",
  "item.activated": "Produto reativado",
  "item.deactivated": "Produto desativado",
  "item.deleted": "Produto excluído",
};

const FIELD_LABEL: Record<string, string> = {
  sale_price: "Preço de venda",
  cost_price: "Preço de custo",
  name: "Nome",
  sku: "SKU",
  barcode: "Código de barras",
  min_stock: "Estoque mínimo",
  active: "Ativo",
  description: "Descrição",
  category: "Categoria",
  manufacturer: "Marca",
  track_serial: "Usa número de série",
};

const fmt = (field: string, v: unknown) =>
  v === null || v === undefined || v === ""
    ? "—"
    : field.endsWith("_price")
      ? formatCurrency(Number(v))
      : typeof v === "boolean"
        ? v ? "sim" : "não"
        : String(v);

export default async function ItemDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string }>;
}) {
  const { id } = await params;
  const { aviso } = await searchParams;
  const { supabase, employee } = await requireEmployee();
  const manager = isManager(employee.role);

  const [
    { data: item, error: itemError },
    { data: suppliers, error: suppliersError },
    { data: movements, error: movementsError },
    { data: history },
    { data: serials },
  ] = await Promise.all([
    supabase.from("items").select("*").eq("id", id).single(),
    supabase.from("suppliers").select("*").order("name"),
    supabase
      .from("movements")
      .select("*, items(id, name, sku, unit), employees(id, full_name)")
      .eq("item_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    // quem mexeu neste produto (RLS: só gerente+ enxerga a auditoria)
    supabase.from("audit_logs").select("*").eq("entity_type", "item").eq("entity_id", id).order("created_at", { ascending: false }).limit(20),
    supabase.from("item_serials").select("*").eq("item_id", id).order("created_at", { ascending: false }).limit(500),
  ]);

  if (itemError)
    console.error(
      `[itens/${id}] erro ao buscar item: code=${itemError.code} message=${itemError.message} details=${itemError.details} hint=${itemError.hint}`
    );
  if (suppliersError)
    console.error(`[itens/${id}] erro ao buscar suppliers: code=${suppliersError.code} message=${suppliersError.message}`);
  if (movementsError)
    console.error(
      `[itens/${id}] erro ao buscar movements: code=${movementsError.code} message=${movementsError.message} details=${movementsError.details} hint=${movementsError.hint}`
    );

  if (!item) {
    notFound();
  }

  const it = item as Item;
  const boundAction = updateItem.bind(null, id);
  const toggle = toggleItemActive.bind(null, id, !it.active);

  return (
    <div className="flex flex-col gap-8">
      {aviso && (
        <div className="card flex items-start gap-2 border-warning/40 bg-warning/5 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warning" />
          <p>
            Produto cadastrado, mas a entrada de estoque com o(s) número(s) de série não foi registrada: {aviso}. Dê
            entrada manualmente em <Link href={`/movimentacoes/nova?item=${id}`} className="font-medium underline">Movimentações</Link>.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/itens" className="text-xs text-muted hover:underline">
            ← Voltar para produtos
          </Link>
          <h1 className="text-xl font-semibold text-foreground">
            {it.name}
            {it.condition === "seminovo" && (
              <span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-sm font-medium text-warning">Seminovo</span>
            )}
            {!it.active && <span className="ml-2 text-sm font-normal text-muted">(inativo)</span>}
          </h1>
        </div>
        {manager && (
          <div className="flex gap-2">
            <form action={toggle}>
              <button type="submit" className="btn-secondary">
                <Power size={15} />
                {it.active ? "Desativar" : "Reativar"}
              </button>
            </form>
            <Link href={`/movimentacoes/nova?item=${it.id}`} className="btn-primary">
              Lançar movimentação
            </Link>
          </div>
        )}
      </div>

      {manager ? (
        <div className="max-w-2xl">
          <ItemForm action={boundAction} item={it} suppliers={(suppliers as Supplier[]) ?? []} />
        </div>
      ) : (
        <div className="card grid max-w-2xl grid-cols-2 gap-4 text-sm">
          <Info label="SKU" value={it.sku ?? "—"} />
          <Info label="Código de barras" value={it.barcode ?? "—"} mono />
          <Info label="Preço de venda" value={it.sale_price === null ? "—" : formatCurrency(it.sale_price)} />
          <Info label="Estoque" value={formatQuantity(it.quantity, it.unit)} />
          <Info label="Marca" value={it.manufacturer ?? "—"} />
          <Info label="Categoria" value={it.category ?? "—"} />
          {it.description && <div className="col-span-2"><Info label="Descrição" value={it.description} /></div>}
        </div>
      )}

      {manager && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Histórico de alterações</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Quando</th>
                  <th className="px-4 py-3">Quem</th>
                  <th className="px-4 py-3">O quê</th>
                </tr>
              </thead>
              <tbody>
                {((history as AuditLog[]) ?? []).map((h) => (
                  <tr key={h.id} className="border-b border-border align-top last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(h.created_at, true)}</td>
                    <td className="px-4 py-3">{h.actor_name ?? "Sistema"}</td>
                    <td className="px-4 py-3">
                      <span className="font-medium text-foreground">{ACTION_LABEL[h.action] ?? h.action}</span>
                      {h.changes && !("new" in h.changes) && !("old" in h.changes) && (
                        <ul className="mt-1 text-xs text-muted">
                          {Object.entries(h.changes as Record<string, { old: unknown; new: unknown }>).map(([field, c]) => (
                            <li key={field}>
                              {FIELD_LABEL[field] ?? field}: {fmt(field, c.old)} → <span className="text-foreground">{fmt(field, c.new)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
                {(!history || history.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted">Sem alterações registradas.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {it.track_serial && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Números de série</h2>
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Número de série</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Entrou em</th>
                </tr>
              </thead>
              <tbody>
                {((serials as ItemSerial[]) ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-foreground">{s.serial}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SERIAL_STATUS_CLASS[s.status]}`}>
                        {SERIAL_STATUS_LABEL[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted">{formatDate(s.created_at, true)}</td>
                  </tr>
                ))}
                {(!serials || serials.length === 0) && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-muted">Nenhum número de série cadastrado ainda.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Histórico de movimentações</h2>
        <MovementsTable
          movements={(movements as MovementWithRelations[]) ?? []}
          showItem={false}
        />
      </div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className={mono ? "font-mono text-sm text-foreground" : "text-sm text-foreground"}>{value}</p>
    </div>
  );
}
