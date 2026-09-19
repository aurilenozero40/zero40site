"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { requireEmployee } from "@/lib/auth/session";
import { normalizeBarcode } from "@/lib/barcode";
import { processNotifications } from "@/lib/notifications";
import { friendlyRpcError } from "@/lib/sales/errors";
import { cancelSaleSchema, customerSchema, returnSaleSchema, saleInputSchema } from "@/lib/validations";
import { escapeLike } from "@/lib/utils";

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export interface ProductHit {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  sale_price: number | null;
  quantity: number;
  /** como achamos: código de barras/SKU exatos valem para "bipar e adicionar" */
  match: "barcode" | "sku" | "name";
}

export interface CustomerHit {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
}

const firstIssue = (issues: { message: string }[]) => issues[0]?.message ?? "Dados inválidos";

/** Depois de qualquer operação que gera evento: tenta entregar sem atrasar a resposta. */
function drainNotificationsAfterResponse() {
  after(async () => {
    await processNotifications();
  });
}

function revalidateSalesViews(saleId?: string) {
  revalidatePath("/vendas");
  if (saleId) revalidatePath(`/vendas/${saleId}`);
  revalidatePath("/dashboard");
  revalidatePath("/itens");
  revalidatePath("/movimentacoes");
}

// ---------------------------------------------------------------------------------------------
// Buscar produto (código de barras, SKU ou nome) para o carrinho
// ---------------------------------------------------------------------------------------------
export async function searchProductsAction(rawQuery: string): Promise<ProductHit[]> {
  const { supabase } = await requireEmployee();
  const q = rawQuery.trim().slice(0, 80);
  if (q.length === 0) return [];

  const columns = "id, name, sku, barcode, unit, sale_price, quantity";
  const digits = /^\d+$/.test(q);
  // Só consulta código de barras quando o texto PARECE um código (sem espaço/aspas/parênteses):
  // evita que texto livre do usuário vire parte da sintaxe do filtro `in`.
  const looksLikeCode = /^[\w.-]+$/.test(q);
  // leitor pode entregar UPC-A (12) como EAN-13 (com 0 na frente) e vice-versa
  const barcodeVariants = digits ? [...new Set([q, normalizeBarcode(q), "0" + normalizeBarcode(q)])] : [q];

  const [byBarcode, bySku, byName] = await Promise.all([
    looksLikeCode
      ? supabase.from("items").select(columns).eq("active", true).in("barcode", barcodeVariants).limit(3)
      : Promise.resolve({ data: [] }),
    supabase.from("items").select(columns).eq("active", true).ilike("sku", escapeLike(q)).limit(3),
    supabase.from("items").select(columns).eq("active", true).ilike("name", `%${escapeLike(q)}%`).order("name").limit(8),
  ]);

  const hits = new Map<string, ProductHit>();
  const add = (rows: unknown[] | null, match: ProductHit["match"]) => {
    for (const row of (rows ?? []) as Omit<ProductHit, "match">[]) {
      if (!hits.has(row.id)) hits.set(row.id, { ...row, sale_price: row.sale_price === null ? null : Number(row.sale_price), quantity: Number(row.quantity), match });
    }
  };
  add(byBarcode.data, "barcode");
  add(bySku.data, "sku");
  add(byName.data, "name");
  return [...hits.values()].slice(0, 10);
}

export async function searchCustomersAction(rawQuery: string): Promise<CustomerHit[]> {
  const { supabase } = await requireEmployee();
  const q = rawQuery.trim().slice(0, 80);
  if (q.length < 2) return [];
  const digits = q.replace(/\D/g, "");

  const [byName, byDoc] = await Promise.all([
    supabase.from("customers").select("id, name, document, phone").eq("active", true).ilike("name", `%${escapeLike(q)}%`).order("name").limit(8),
    digits.length >= 4
      ? supabase.from("customers").select("id, name, document, phone").eq("active", true).or(`document.eq.${digits},phone.like.%${digits}%`).limit(5)
      : Promise.resolve({ data: [] as CustomerHit[] }),
  ]);

  const merged = new Map<string, CustomerHit>();
  for (const row of [...(byDoc.data ?? []), ...(byName.data ?? [])] as CustomerHit[]) merged.set(row.id, row);
  return [...merged.values()].slice(0, 8);
}

/** Cadastro rápido de cliente dentro da venda (só o essencial). */
export async function createCustomerQuickAction(input: unknown): Promise<ActionResult<CustomerHit>> {
  const { supabase } = await requireEmployee();
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error.issues) };

  const { data, error } = await supabase.from("customers").insert(parsed.data).select("id, name, document, phone").single();
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Já existe um cliente com esse CPF/CNPJ." };
    return { ok: false, error: friendlyRpcError(error) };
  }
  revalidatePath("/clientes");
  return { ok: true, data: data as CustomerHit };
}

// ---------------------------------------------------------------------------------------------
// Vender / cancelar / devolver — tudo delegado às funções transacionais do banco
// ---------------------------------------------------------------------------------------------
export interface SaleCreated {
  saleId: string;
  code: string;
  total: number;
  alreadyProcessed: boolean;
}

export async function createSaleAction(input: unknown): Promise<ActionResult<SaleCreated>> {
  const { supabase } = await requireEmployee();
  const parsed = saleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error.issues) };
  const s = parsed.data;

  // O vendedor NÃO vai no payload: o banco usa o usuário autenticado da sessão.
  const { data, error } = await supabase.rpc("create_sale", {
    p_idempotency_key: s.idempotencyKey,
    p_customer_id: s.customerId ?? null,
    p_items: s.items.map((i) => ({ item_id: i.itemId, quantity: i.quantity })),
    p_discount_amount: s.discountAmount,
    p_payment_method: s.paymentMethod,
    p_installments: s.installments,
    p_interest_percent: s.interestPercent,
    p_card_brand: s.cardBrand ?? null,
    p_notes: s.notes ?? null,
  });
  if (error) return { ok: false, error: friendlyRpcError(error) };

  const result = data as { sale_id: string; code: string; total: number; already_processed: boolean };
  revalidateSalesViews(result.sale_id);
  drainNotificationsAfterResponse();
  return {
    ok: true,
    data: { saleId: result.sale_id, code: result.code, total: Number(result.total), alreadyProcessed: result.already_processed },
  };
}

export async function cancelSaleAction(input: unknown): Promise<ActionResult> {
  const { supabase } = await requireEmployee();
  const parsed = cancelSaleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error.issues) };

  const { error } = await supabase.rpc("cancel_sale", { p_sale_id: parsed.data.saleId, p_reason: parsed.data.reason });
  if (error) return { ok: false, error: friendlyRpcError(error) };

  revalidateSalesViews(parsed.data.saleId);
  drainNotificationsAfterResponse();
  return { ok: true, data: undefined };
}

export async function returnSaleItemsAction(input: unknown): Promise<ActionResult<{ refund: number }>> {
  const { supabase } = await requireEmployee();
  const parsed = returnSaleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error.issues) };
  const r = parsed.data;

  const { data, error } = await supabase.rpc("return_sale_items", {
    p_sale_id: r.saleId,
    p_items: r.items.map((i) => ({ sale_item_id: i.saleItemId, quantity: i.quantity })),
    p_reason: r.reason,
    p_idempotency_key: r.idempotencyKey,
  });
  if (error) return { ok: false, error: friendlyRpcError(error) };

  revalidateSalesViews(r.saleId);
  drainNotificationsAfterResponse();
  return { ok: true, data: { refund: Number((data as { refund?: number }).refund ?? 0) } };
}
