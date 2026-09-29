import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addItem, createTestDb, ids, sell, type TestDb } from "./helpers";

/** % de participação de cada produto no faturamento (item_sales_ranking) — usado na tela de Produtos. */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

describe("item_sales_ranking", () => {
  it("calcula a % de cada item sobre o faturamento total", async () => {
    const a = await addItem(db, { name: "Ranking A", price: 300, stock: 10 });
    const b = await addItem(db, { name: "Ranking B", price: 100, stock: 10 });
    await sell(db, ids.manager, { items: [{ item_id: a, quantity: 3 }] }); // 900
    await sell(db, ids.manager, { items: [{ item_id: b, quantity: 1 }] }); // 100

    const r = await db.asUser(ids.manager, (c) => c.query("select public.item_sales_ranking() as r"));
    const list = r.rows[0].r as { item_id: string; units_sold: number; revenue: number; share_percent: number }[];
    const ra = list.find((x) => x.item_id === a)!;
    const rb = list.find((x) => x.item_id === b)!;
    expect(ra.units_sold).toBe(3);
    expect(ra.revenue).toBe(900);
    expect(rb.units_sold).toBe(1);
    expect(rb.revenue).toBe(100);
    expect(ra.share_percent).toBeGreaterThan(rb.share_percent);
  });

  it("devolução parcial reduz a receita proporcionalmente", async () => {
    const item = await addItem(db, { name: "Ranking C", price: 200, stock: 10 });
    const sale = await sell(db, ids.manager, { items: [{ item_id: item, quantity: 2 }] }); // 400
    const si = await db.one<{ id: string }>("select id from sale_items where sale_id = $1", [sale.sale_id]);
    await db.asUser(ids.manager, (c) =>
      c.query("select public.return_sale_items($1, $2::jsonb, 'defeito', $3)", [
        sale.sale_id,
        JSON.stringify([{ sale_item_id: si.id, quantity: 1 }]),
        crypto.randomUUID(),
      ])
    );

    const r = await db.asUser(ids.manager, (c) => c.query("select public.item_sales_ranking() as r"));
    const list = r.rows[0].r as { item_id: string; units_sold: number; revenue: number }[];
    const row = list.find((x) => x.item_id === item)!;
    expect(row.units_sold).toBe(1); // 2 vendidos - 1 devolvido
    expect(row.revenue).toBe(200); // metade do faturamento da linha
  });

  it("vendedor só vê o que é dele (RLS já filtra sales)", async () => {
    const item = await addItem(db, { name: "Ranking D", price: 50, stock: 10 });
    await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    await sell(db, ids.seller2, { items: [{ item_id: item, quantity: 1 }] });

    const [asSeller, asManager] = await Promise.all([
      db.asUser(ids.seller, (c) => c.query("select public.item_sales_ranking() as r")),
      db.asUser(ids.manager, (c) => c.query("select public.item_sales_ranking() as r")),
    ]);
    const sellerList = asSeller.rows[0].r as { item_id: string; units_sold: number }[];
    const managerList = asManager.rows[0].r as { item_id: string; units_sold: number }[];
    expect(sellerList.find((x) => x.item_id === item)?.units_sold).toBe(1); // só a própria venda
    expect(managerList.find((x) => x.item_id === item)?.units_sold).toBe(2); // as duas
  });
});
