import { requireManager } from "@/lib/auth/session";
import { MovementForm } from "@/components/movements/MovementForm";
import { StockEntryForm } from "@/components/movements/StockEntryForm";
import { createMovement } from "../actions";
import type { Item, Supplier } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NovaMovimentacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const { item } = await searchParams;
  const { supabase } = await requireManager();
  const [{ data: items, error }, { data: suppliers }] = await Promise.all([
    supabase.from("items").select("*").eq("active", true).order("name"),
    supabase.from("suppliers").select("id, name").order("name"),
  ]);

  if (error)
    console.error(
      `[movimentacoes/nova] erro ao buscar items: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
    );

  return (
    <div className="flex flex-col gap-10">
      <div className="flex max-w-4xl flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Entrada de estoque</h1>
          <p className="text-sm text-muted">Uma nota com um ou vários produtos — bipe o código de barras de cada um.</p>
        </div>
        <StockEntryForm items={(items as Item[]) ?? []} suppliers={(suppliers as Pick<Supplier, "id" | "name">[]) ?? []} />
      </div>

      <div className="flex max-w-2xl flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Saída ou ajuste</h2>
          <p className="text-sm text-muted">Perda, uso interno, empréstimo ou correção de contagem — um item por vez.</p>
        </div>
        <MovementForm action={createMovement} items={(items as Item[]) ?? []} defaultItemId={item} />
      </div>
    </div>
  );
}
