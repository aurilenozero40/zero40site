import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ItemForm } from "@/components/items/ItemForm";
import { MovementsTable } from "@/components/movements/MovementsTable";
import { updateItem } from "../actions";
import type { Item, MovementWithRelations, Supplier } from "@/lib/types";

export default async function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: item }, { data: suppliers }, { data: movements }] = await Promise.all([
    supabase.from("items").select("*").eq("id", id).single(),
    supabase.from("suppliers").select("*").order("name"),
    supabase
      .from("movements")
      .select("*, items(id, name, sku, unit), employees(id, full_name)")
      .eq("item_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (!item) {
    notFound();
  }

  const boundAction = updateItem.bind(null, id);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/itens" className="text-xs text-muted hover:underline">
            ← Voltar para itens
          </Link>
          <h1 className="text-xl font-semibold text-foreground">{item.name}</h1>
        </div>
        <Link href={`/movimentacoes/nova?item=${item.id}`} className="btn-primary">
          Lançar movimentação
        </Link>
      </div>

      <div className="max-w-2xl">
        <ItemForm
          action={boundAction}
          item={item as Item}
          suppliers={(suppliers as Supplier[]) ?? []}
        />
      </div>

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
