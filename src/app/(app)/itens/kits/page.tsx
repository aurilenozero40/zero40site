import Link from "next/link";
import { requireManager } from "@/lib/auth/session";
import { KitForm } from "@/components/items/KitForm";
import { toggleKitActiveAction } from "./actions";
import { formatCurrency } from "@/lib/utils";
import type { Item, Kit } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function KitsPage() {
  const { supabase } = await requireManager();

  const [{ data: kits, error }, { data: items }] = await Promise.all([
    supabase.from("kits").select("*").order("created_at", { ascending: false }),
    supabase.from("items").select("*").eq("active", true).order("name"),
  ]);

  if (error) console.error(`[itens/kits] erro: code=${error.code} message=${error.message}`);
  const itemList = (items as Item[]) ?? [];
  const itemById = new Map(itemList.map((i) => [i.id, i]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/itens" className="text-xs text-muted hover:underline">
          ← Voltar para produtos
        </Link>
        <h1 className="text-xl font-semibold text-foreground">Kits e combos</h1>
        <p className="text-sm text-muted">Vender produtos juntos por um preço especial — cada um baixa do próprio estoque normalmente.</p>
      </div>

      <div className="max-w-2xl">
        <KitForm items={itemList} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Kits cadastrados</h2>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Kit</th>
                <th className="px-4 py-3">Produtos</th>
                <th className="px-4 py-3 text-right">Preço normal</th>
                <th className="px-4 py-3 text-right">Preço do kit</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {((kits as Kit[]) ?? []).map((k) => {
                const normalPrice = k.items.reduce((s, ki) => s + (itemById.get(ki.item_id)?.sale_price ?? 0) * ki.quantity, 0);
                const toggle = toggleKitActiveAction.bind(null, k.id, !k.active);
                return (
                  <tr key={k.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-foreground">
                      {k.name}
                      {!k.active && <span className="ml-2 text-xs font-normal text-muted">(inativo)</span>}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {k.items.map((ki) => `${ki.quantity}x ${itemById.get(ki.item_id)?.name ?? "produto removido"}`).join(", ")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted line-through">{formatCurrency(normalPrice)}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-foreground">{formatCurrency(k.kit_price)}</td>
                    <td className="px-4 py-3 text-right">
                      <form action={toggle}>
                        <button type="submit" className="text-xs text-muted hover:text-foreground">
                          {k.active ? "Desativar" : "Reativar"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {(!kits || kits.length === 0) && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    Nenhum kit cadastrado ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
