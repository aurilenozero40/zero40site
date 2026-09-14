import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MovementsTable } from "@/components/movements/MovementsTable";
import type { MovementWithRelations } from "@/lib/types";

// Sempre busca dado fresco — ver dashboard/page.tsx.
export const dynamic = "force-dynamic";

export default async function MovimentacoesPage() {
  const supabase = await createClient();
  const { data: movements, error } = await supabase
    .from("movements")
    .select("*, items(id, name, sku, unit), employees(id, full_name)")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error)
    console.error(
      `[movimentacoes] erro ao buscar movements: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
    );

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
