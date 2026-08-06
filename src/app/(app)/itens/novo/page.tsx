import { createClient } from "@/lib/supabase/server";
import { ItemForm } from "@/components/items/ItemForm";
import { createItem } from "../actions";
import type { Supplier } from "@/lib/types";

export default async function NovoItemPage() {
  const supabase = await createClient();
  const { data: suppliers } = await supabase.from("suppliers").select("*").order("name");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Novo item</h1>
      <ItemForm action={createItem} suppliers={(suppliers as Supplier[]) ?? []} />
    </div>
  );
}
