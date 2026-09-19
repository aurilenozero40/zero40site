import Link from "next/link";
import { Plus } from "lucide-react";
import { requireManager } from "@/lib/auth/session";
import { MovementsTable } from "@/components/movements/MovementsTable";
import { Pagination, parsePage } from "@/components/ui/pagination";
import type { MovementWithRelations } from "@/lib/types";

// Sempre busca dado fresco — ver dashboard/page.tsx.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export default async function MovimentacoesPage({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const { supabase } = await requireManager();
  const page = parsePage((await searchParams).pagina);

  const { data: movements, count, error } = await supabase
    .from("movements")
    .select("*, items(id, name, sku, unit), employees(id, full_name)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (error)
    console.error(
      `[movimentacoes] erro ao buscar movements: code=${error.code} message=${error.message} details=${error.details} hint=${error.hint}`
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Movimentações de estoque</h1>
        <Link href="/movimentacoes/nova" className="btn-primary">
          <Plus size={16} />
          Nova movimentação
        </Link>
      </div>
      <MovementsTable movements={(movements as MovementWithRelations[]) ?? []} />
      <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/movimentacoes" params={{}} />
    </div>
  );
}
