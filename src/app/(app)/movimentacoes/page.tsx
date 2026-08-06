import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MovementsTable } from "@/components/movements/MovementsTable";
import type { MovementWithRelations } from "@/lib/types";

export default async function MovimentacoesPage() {
  const supabase = await createClient();
  const { data: movements } = await supabase
    .from("movements")
    .select("*, items(id, name, sku, unit), employees(id, full_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Movimentações</h1>
        <Link href="/movimentacoes/nova" className="btn-primary">
          <Plus size={16} />
          Nova movimentação
        </Link>
      </div>
      <MovementsTable movements={(movements as MovementWithRelations[]) ?? []} />
    </div>
  );
}
