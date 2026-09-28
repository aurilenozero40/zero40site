import { requireManager } from "@/lib/auth/session";
import { MovementForm } from "@/components/movements/MovementForm";
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
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Nova movimentação</h1>
      <MovementForm
        action={createMovement}
        items={(items as Item[]) ?? []}
        suppliers={(suppliers as Pick<Supplier, "id" | "name">[]) ?? []}
        defaultItemId={item}
      />
    </div>
  );
}
