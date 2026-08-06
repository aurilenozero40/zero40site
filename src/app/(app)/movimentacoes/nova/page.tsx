import { createClient } from "@/lib/supabase/server";
import { MovementForm } from "@/components/movements/MovementForm";
import { createMovement } from "../actions";
import type { Item } from "@/lib/types";

export default async function NovaMovimentacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const { item } = await searchParams;
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("items")
    .select("*")
    .eq("active", true)
    .order("name");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Nova movimentação</h1>
      <MovementForm action={createMovement} items={(items as Item[]) ?? []} defaultItemId={item} />
    </div>
  );
}
