import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ItemsTable } from "@/components/items/ItemsTable";
import type { Item } from "@/lib/types";

export default async function ItensPage() {
  const supabase = await createClient();
  const { data: items } = await supabase
    .from("items")
    .select("*")
    .order("name");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Itens</h1>
        <Link href="/itens/novo" className="btn-primary">
          <Plus size={16} />
          Novo item
        </Link>
      </div>
      <ItemsTable items={(items as Item[]) ?? []} />
    </div>
  );
}
