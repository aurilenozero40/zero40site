import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addItem, callCreateSale, createTestDb, ids, type TestDb } from "./helpers";
import { computeCardFee, computeSaleTotals, feeKey, lineTotalCents, toCents } from "@/lib/sales/pricing";

/**
 * O resumo que o vendedor vê na tela (TypeScript) TEM que dar exatamente o que o banco grava (SQL).
 * Aqui rodamos centenas de vendas aleatórias e comparamos centavo por centavo.
 */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

// gerador determinístico (mesmos casos em toda execução)
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

describe("paridade TS ↔ SQL", () => {
  it("400 vendas aleatórias: subtotal, juros, total, parcela, taxa e líquido idênticos", async () => {
    const rand = rng(42);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)];
    const item = await addItem(db, { name: "Paridade", price: 1, stock: 1 });
    await db.q("insert into movements (item_id, type, subtype, quantity, created_by) values ($1,'entrada','compra',900000,$2)", [item, ids.admin]);

    const c = await db.connect();
    const rates = new Map(
      (await db.q<{ brand: string; installments: number; fee_percent: string }>("select brand, installments, fee_percent from card_fee_rates")).map((r) => [
        `${r.brand}:${r.installments}`,
        Number(r.fee_percent),
      ])
    );
    let compared = 0;
    try {
      for (let i = 0; i < 400; i++) {
        const priceCents = 1 + Math.floor(rand() * 999_999);
        const qty = pick([1, 1, 2, 3, 0.5, 2.75, 10, 0.125, 7.333]);
        await db.q("update items set sale_price = $2 where id = $1", [item, priceCents / 100]);

        const line = lineTotalCents(priceCents, qty);
        const discountCents = rand() < 0.4 ? Math.floor(rand() * Math.max(1, line - 1)) : 0;
        const method = pick(["pix", "dinheiro", "debito", "credito_vista", "credito_parcelado"] as const);
        const brand = pick(["visa", "master"] as const);
        const installments = method === "credito_parcelado" ? pick([2, 10, 12]) : 1;
        const interest = method === "credito_parcelado" ? Math.round(rand() * 50000) / 1000 : 0; // 0–50%, 3 casas

        const totals = computeSaleTotals({ subtotalCents: line, discountCents, method, installments, interestPercent: interest });
        if (totals.baseCents <= 0) continue;

        const sale = await db.asUser(
          ids.manager,
          (cl) =>
            callCreateSale(cl, {
              items: [{ item_id: item, quantity: qty }],
              discount: discountCents / 100,
              method,
              installments,
              interest,
              brand: method === "pix" || method === "dinheiro" ? null : brand,
            }),
          c
        );

        const row = await db.one<Record<string, string | null>>(
          `select s.subtotal, s.discount_amount, s.interest_amount, s.total, p.installment_value, p.fee_amount, p.net_amount
             from sales s join sale_payments p on p.sale_id = s.id where s.id = $1`,
          [sale.sale_id]
        );
        const ctx = JSON.stringify({ priceCents, qty, discountCents, method, installments, interest });
        expect(toCents(Number(row.subtotal)), ctx).toBe(totals.subtotalCents);
        expect(toCents(Number(row.interest_amount)), ctx).toBe(totals.interestCents);
        expect(toCents(Number(row.total)), ctx).toBe(totals.totalCents);
        expect(toCents(Number(row.installment_value)), ctx).toBe(totals.installmentCents);

        const key = feeKey(method, installments);
        if (key !== null) {
          const pct = rates.get(`${brand}:${key}`)!;
          const fee = computeCardFee(totals.totalCents, pct);
          expect(toCents(Number(row.fee_amount)), ctx).toBe(fee.feeCents);
          expect(toCents(Number(row.net_amount)), ctx).toBe(fee.netCents);
        }
        compared++;
      }
    } finally {
      await c.end();
    }
    expect(compared).toBeGreaterThan(300);
  }, 180_000);
});
