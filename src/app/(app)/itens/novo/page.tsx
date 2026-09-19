import { requireManager } from "@/lib/auth/session";
import { ItemForm } from "@/components/items/ItemForm";
import { createItem } from "../actions";
import type { Supplier } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NovoItemPage() {
  const { supabase } = await requireManager();
  const { data: suppliers } = await supabase.from("suppliers").select("*").order("name");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Novo produto</h1>
      <p className="-mt-3 text-sm text-muted">
        O estoque inicial entra depois, por uma <strong>Entrada</strong> em Estoque — assim fica registrado quem deu entrada e quando.
      </p>
      <ItemForm action={createItem} suppliers={(suppliers as Supplier[]) ?? []} />
    </div>
  );
}
