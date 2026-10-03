import { AlertTriangle } from "lucide-react";
import { requireEmployee } from "@/lib/auth/session";
import { PosScreen } from "@/components/sales/PosScreen";
import { ratesFromRows } from "@/lib/sales/brands";
import { isManager } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function NovaVendaPage() {
  const { supabase, employee } = await requireEmployee();

  const [{ data: limits, error: limitsError }, { data: rateRows, error: ratesError }, { data: kitsData }] = await Promise.all([
    supabase.rpc("sale_limits"),
    supabase.from("card_fee_rates").select("brand, installments, fee_percent"),
    supabase.from("kits").select("*").eq("active", true).order("name"),
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

  // Resolve os produtos de cada kit (preço/estoque atuais); kit com item serializado ou indisponível
  // não entra na lista — monta esse carrinho na mão (o número de série precisa ser bipado).
  const kitItemIds = [...new Set(((kitsData ?? []) as { items: { item_id: string; quantity: number }[] }[]).flatMap((k) => k.items.map((i) => i.item_id)))];
  const { data: kitItemRows } = kitItemIds.length
    ? await supabase.from("items").select("id, name, sku, barcode, unit, sale_price, quantity, track_serial, active").in("id", kitItemIds)
    : { data: [] as never[] };
  const kitItemById = new Map(((kitItemRows ?? []) as { id: string }[]).map((i) => [i.id, i as { id: string; name: string; sku: string | null; barcode: string | null; unit: string; sale_price: number | null; quantity: number; track_serial: boolean; active: boolean }]));

  const kits = ((kitsData ?? []) as { id: string; name: string; kit_price: number; items: { item_id: string; quantity: number }[] }[])
    .map((k) => {
      const components = k.items.map((ci) => {
        const it = kitItemById.get(ci.item_id);
        return it ? { itemId: it.id, name: it.name, sku: it.sku, barcode: it.barcode, unit: it.unit, salePrice: it.sale_price, stock: it.quantity, trackSerial: it.track_serial, active: it.active, quantity: ci.quantity } : null;
      });
      if (components.some((c) => !c || !c.active || c.trackSerial || c.salePrice === null || c.stock < c.quantity)) return null;
      const validComponents = components as NonNullable<(typeof components)[number]>[];
      const normalPrice = validComponents.reduce((s, c) => s + (c.salePrice ?? 0) * c.quantity, 0);
      return { id: k.id, name: k.name, kitPrice: Number(k.kit_price), normalPrice, components: validComponents };
    })
    .filter((k): k is NonNullable<typeof k> => k !== null);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-foreground">Nova venda</h1>
      <PosScreen
        feeRates={ratesFromRows((rateRows ?? []) as { brand: string; installments: number; fee_percent: number }[])}
        discountLimitPercent={Number(lim.discount_limit_percent)}
        maxInterestPercent={Number(lim.max_interest_percent)}
        canSeeFees={isManager(employee.role)}
        kits={kits}
      />
    </div>
  );
}
