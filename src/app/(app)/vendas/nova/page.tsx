import { AlertTriangle } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { PosScreen } from "@/components/sales/PosScreen";
import { ratesFromRows } from "@/lib/sales/brands";
import { isManager } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function NovaVendaPage() {
  const { supabase, employee } = await requireEmployee();

  const [{ data: limits, error: limitsError }, { data: rateRows, error: ratesError }] = await Promise.all([
    supabase.rpc("sale_limits"),
    supabase.from("card_fee_rates").select("brand, installments, fee_percent"),
  ]);

  // Banco ainda sem o schema novo (funções de venda não existem): avisa em vez de quebrar.
  if (limitsError) {
    console.error("[vendas/nova] sale_limits falhou:", limitsError.code, limitsError.message);
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <h1 className="text-xl font-semibold text-foreground">Nova venda</h1>
        <div className="card flex gap-3 border-warning/40 bg-warning/5">
          <AlertTriangle className="mt-0.5 shrink-0 text-warning" size={18} />
          <p className="text-sm text-foreground">
            O banco de dados ainda não foi atualizado para o módulo de vendas. Rode o arquivo <strong>supabase/schema.sql</strong> no SQL Editor do Supabase e recarregue esta página.
          </p>
        </div>
      </div>
    );
  }
  if (ratesError) console.error("[vendas/nova] card_fee_rates falhou:", ratesError.message);

  const lim = limits as { discount_limit_percent: number; max_interest_percent: number };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Nova venda</h1>
      <PosScreen
        feeRates={ratesFromRows((rateRows ?? []) as { brand: string; installments: number; fee_percent: number }[])}
        discountLimitPercent={Number(lim.discount_limit_percent)}
        maxInterestPercent={Number(lim.max_interest_percent)}
        canSeeFees={isManager(employee.role)}
      />
    </div>
  );
}
