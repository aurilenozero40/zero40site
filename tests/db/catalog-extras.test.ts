import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addItem, createTestDb, ids, sell, type TestDb } from "./helpers";

/** Garantia, kits e os campos novos de relatório (categoria/marca, entrada na venda). */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

describe("items.warranty_months", () => {
  it("aceita null (sem garantia controlada) e recusa valor <= 0", async () => {
    await expect(
      db.q("insert into items (name, sale_price, warranty_months, created_by) values ('Sem garantia', 10, null, $1)", [ids.admin])
    ).resolves.toBeTruthy();
    await expect(
      db.q("insert into items (name, sale_price, warranty_months, created_by) values ('Com garantia', 10, 12, $1)", [ids.admin])
    ).resolves.toBeTruthy();
    await expect(
      db.q("insert into items (name, sale_price, warranty_months, created_by) values ('Garantia inválida', 10, 0, $1)", [ids.admin])
    ).rejects.toThrow();
  });
});

describe("kits: leitura pra todos, escrita só gerente+", () => {
  it("vendedor não cria kit; gerente cria; todos leem", async () => {
    const item = await addItem(db, { name: "Componente do kit", price: 50, stock: 5 });
    const kitPayload = { name: "Kit teste", kit_price: 80, items: [{ item_id: item, quantity: 1 }] };

    const seller = await db.asUser(ids.seller, (c) =>
      c.query("insert into kits (name, kit_price, items) values ($1, $2, $3::jsonb)", [kitPayload.name, kitPayload.kit_price, JSON.stringify(kitPayload.items)])
    ).catch((e) => e);
    expect((seller as { code?: string }).code).toBe("42501");

    const manager = await db.asUser(ids.manager, (c) =>
      c.query("insert into kits (name, kit_price, items) values ($1, $2, $3::jsonb) returning id", [
        kitPayload.name,
        kitPayload.kit_price,
        JSON.stringify(kitPayload.items),
      ])
    );
    const kitId = manager.rows[0].id as string;

    const readAsSeller = await db.asUser(ids.seller, (c) => c.query("select * from kits where id = $1", [kitId]));
    expect(readAsSeller.rows).toHaveLength(1);
  });
});

describe("item_sales_ranking traz categoria e marca", () => {
  it("devolve category e manufacturer de cada item", async () => {
    const row = await db.one<{ id: string }>(
      "insert into items (name, sale_price, category, manufacturer, created_by) values ('Rastreador cat', 200, 'GPS', 'Garmin', $1) returning id",
      [ids.admin]
    );
    await db.q("insert into movements (item_id, type, subtype, quantity, created_by) values ($1,'entrada','compra',5,$2)", [row.id, ids.admin]);
    await sell(db, ids.manager, { items: [{ item_id: row.id, quantity: 1 }] });

    const r = await db.asUser(ids.manager, (c) => c.query("select public.item_sales_ranking() as r"));
    const list = r.rows[0].r as { item_id: string; category: string | null; manufacturer: string | null }[];
    const found = list.find((x) => x.item_id === row.id)!;
    expect(found.category).toBe("GPS");
    expect(found.manufacturer).toBe("Garmin");
  });
});

describe("sales_dashboard traz trade_in_total", () => {
  it("soma o valor de entrada (troca) das vendas do período", async () => {
    const item = await addItem(db, { name: "Dashboard troca", price: 1000, stock: 5 });
    await sell(db, ids.manager, {
      items: [{ item_id: item, quantity: 1 }],
      tradeIn: { item_name: "Usado dashboard", value: 300 },
    });

    const r = await db.asUser(ids.manager, (c) =>
      c.query("select public.sales_dashboard(now() - interval '1 hour', now() + interval '1 hour') as r")
    );
    const d = r.rows[0].r as { trade_in_total: number };
    expect(Number(d.trade_in_total)).toBeGreaterThanOrEqual(300);
  });
});
