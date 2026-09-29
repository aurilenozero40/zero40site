import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addItem, createTestDb, hintOf, ids, type TestDb } from "./helpers";

/**
 * Entrada de estoque em LOTE: uma nota com vários produtos de uma vez (create_stock_entry),
 * cada linha já vem agrupada por item+fornecedor do lado do cliente. Tudo numa transação só —
 * se uma linha falhar, nada é gravado.
 */
let db: TestDb;
let supplier: string;
let supplier2: string;
beforeAll(async () => {
  db = await createTestDb("upgrade");
  const rows = await db.q<{ id: string }>("select id from suppliers order by name limit 2");
  supplier = rows[0].id;
  supplier2 = rows[1].id;
});
afterAll(async () => {
  await db.close();
});

const entry = (items: unknown[], subtype = "compra", reason: string | null = null) =>
  db.asUser(ids.manager, (c) => c.query("select public.create_stock_entry($1::jsonb, $2, $3) as r", [JSON.stringify(items), subtype, reason]));

describe("entrada de estoque em lote (nota com vários produtos)", () => {
  it("processa várias linhas (itens diferentes) numa nota só", async () => {
    const a = await addItem(db, { name: "Nota A" });
    const b = await addItem(db, { name: "Nota B" });
    const r = await entry([
      { item_id: a, quantity: 10, supplier_id: supplier },
      { item_id: b, quantity: 3, supplier_id: supplier },
    ]);
    expect((r.rows[0].r as { count: number }).count).toBe(2);

    const [qa, qb] = await Promise.all([
      db.one<{ quantity: string }>("select quantity from items where id = $1", [a]),
      db.one<{ quantity: string }>("select quantity from items where id = $1", [b]),
    ]);
    expect(Number(qa.quantity)).toBe(10);
    expect(Number(qb.quantity)).toBe(3);
  });

  it("mistura item por quantidade e item com número de série na mesma nota", async () => {
    const qtyItem = await addItem(db, { name: "Nota C" });
    const serialItem = await db.one<{ id: string }>(
      "insert into items (name, sale_price, track_serial, created_by) values ('Nota D', 100, true, $1) returning id",
      [ids.admin]
    );
    await entry([
      { item_id: qtyItem, quantity: 5, supplier_id: supplier },
      { item_id: serialItem.id, serials: ["NOTA-D-1", "NOTA-D-2"], supplier_id: supplier },
    ]);

    const [qa, qb] = await Promise.all([
      db.one<{ quantity: string }>("select quantity from items where id = $1", [qtyItem]),
      db.one<{ quantity: string }>("select quantity from items where id = $1", [serialItem.id]),
    ]);
    expect(Number(qa.quantity)).toBe(5);
    expect(Number(qb.quantity)).toBe(2);
  });

  it("se uma linha falhar, NENHUMA é gravada (tudo ou nada)", async () => {
    const good = await addItem(db, { name: "Nota E" });
    const bad = await addItem(db, { name: "Nota F" }); // sem fornecedor lembrado e nenhum informado

    const hint = await hintOf(
      entry([
        { item_id: good, quantity: 7, supplier_id: supplier },
        { item_id: bad, quantity: 2 }, // 'compra' sem fornecedor -> falha
      ])
    );
    expect(hint).toBe("SUPPLIER_REQUIRED");

    const row = await db.one<{ quantity: string }>("select quantity from items where id = $1", [good]);
    expect(Number(row.quantity)).toBe(0); // a linha boa NÃO ficou de pé
  });

  it("vendedor não lança entrada em lote", async () => {
    const item = await addItem(db, { name: "Nota G" });
    const hint = await hintOf(
      db.asUser(ids.seller, (c) => c.query("select public.create_stock_entry($1::jsonb, 'compra', null)", [JSON.stringify([{ item_id: item, quantity: 1, supplier_id: supplier }])]))
    );
    expect(hint).toBe("FORBIDDEN");
  });

  it("recusa nota vazia", async () => {
    expect(await hintOf(entry([]))).toBe("EMPTY_CART");
  });

  it("cada item guarda o fornecedor certo mesmo com fornecedores diferentes na mesma nota", async () => {
    const a = await addItem(db, { name: "Nota H" });
    const b = await addItem(db, { name: "Nota I" });
    await entry([
      { item_id: a, quantity: 1, supplier_id: supplier },
      { item_id: b, quantity: 1, supplier_id: supplier2 },
    ]);
    const [ra, rb] = await Promise.all([
      db.one<{ supplier_id: string }>("select supplier_id from items where id = $1", [a]),
      db.one<{ supplier_id: string }>("select supplier_id from items where id = $1", [b]),
    ]);
    expect(ra.supplier_id).toBe(supplier);
    expect(rb.supplier_id).toBe(supplier2);
  });
});
