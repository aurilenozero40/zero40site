import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { addItem, createTestDb, hintOf, ids, sell, stockOf, type TestDb } from "./helpers";

/**
 * Entrada (troca): o cliente entrega um produto usado que abate o total da venda. O banco
 * cadastra esse produto como seminovo e dá entrada de 1 unidade, tudo na mesma transação.
 */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

describe("venda com entrada (troca)", () => {
  it("abate o total, cadastra o item como seminovo com 1 em estoque e custo = valor da entrada", async () => {
    const item = await addItem(db, { name: "Relógio novo", price: 1000, stock: 5 });
    const sale = await sell(db, ids.seller, {
      items: [{ item_id: item, quantity: 1 }],
      tradeIn: { item_name: "Relógio Casio usado", category: "Relógios", value: 300 },
    });
    expect(sale.total).toBe(700);

    const row = await db.one<{ trade_in_amount: string; trade_in_item_id: string }>(
      "select trade_in_amount, trade_in_item_id from sales where id = $1",
      [sale.sale_id]
    );
    expect(Number(row.trade_in_amount)).toBe(300);
    expect(row.trade_in_item_id).toBeTruthy();

    const ti = await db.one<{ name: string; condition: string; quantity: string; cost_price: string; category: string }>(
      "select name, condition, quantity, cost_price, category from items where id = $1",
      [row.trade_in_item_id]
    );
    expect(ti.name).toBe("Relógio Casio usado");
    expect(ti.condition).toBe("seminovo");
    expect(Number(ti.quantity)).toBe(1);
    expect(Number(ti.cost_price)).toBe(300);
    expect(ti.category).toBe("Relógios");

    expect(
      await db.one<{ n: string }>(
        "select count(*) n from movements where item_id = $1 and type = 'entrada' and subtype = 'troca'",
        [row.trade_in_item_id]
      )
    ).toEqual({ n: "1" });
  });

  it("recusa entrada sem nome, sem valor, ou que cobriria o total inteiro da venda", async () => {
    const item = await addItem(db, { name: "Relógio B", price: 100, stock: 5 });
    const attempt = (tradeIn: { item_name: string; value: number }) =>
      sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }], tradeIn });

    expect(await hintOf(attempt({ item_name: "", value: 10 }))).toBe("TRADE_IN_ITEM_REQUIRED");
    expect(await hintOf(attempt({ item_name: "Algo", value: 0 }))).toBe("TRADE_IN_VALUE_REQUIRED");
    expect(await hintOf(attempt({ item_name: "Algo", value: 100 }))).toBe("TRADE_IN_EXCEEDS_TOTAL");
    expect(await hintOf(attempt({ item_name: "Algo", value: 150 }))).toBe("TRADE_IN_EXCEEDS_TOTAL");
  });

  it("não conta no limite de desconto do vendedor (é abatido separado)", async () => {
    const item = await addItem(db, { name: "Relógio C", price: 1000, stock: 5 });
    // vendedor não pode dar desconto (limite 0%), mas a entrada é um eixo separado do desconto
    const sale = await sell(db, ids.seller, {
      items: [{ item_id: item, quantity: 1 }],
      discount: 0,
      tradeIn: { item_name: "Algo usado", value: 400 },
    });
    expect(sale.total).toBe(600);
  });
});

describe("cancelamento com entrada (troca)", () => {
  it("cancelar a venda tira o item seminovo do estoque e o desativa", async () => {
    const item = await addItem(db, { name: "Relógio D", price: 1000, stock: 5 });
    const sale = await sell(db, ids.seller, {
      items: [{ item_id: item, quantity: 1 }],
      tradeIn: { item_name: "Relógio E", value: 200 },
    });
    const { trade_in_item_id: tiId } = await db.one<{ trade_in_item_id: string }>(
      "select trade_in_item_id from sales where id = $1",
      [sale.sale_id]
    );

    await db.asUser(ids.manager, (c) => c.query("select public.cancel_sale($1, 'cliente desistiu')", [sale.sale_id]));

    expect(await stockOf(db, tiId)).toBe(0);
    const ti = await db.one<{ active: boolean }>("select active from items where id = $1", [tiId]);
    expect(ti.active).toBe(false);
  });

  it("bloqueia o cancelamento se o item recebido de entrada já foi revendido", async () => {
    const item = await addItem(db, { name: "Relógio F", price: 1000, stock: 5 });
    const sale = await sell(db, ids.seller, {
      items: [{ item_id: item, quantity: 1 }],
      tradeIn: { item_name: "Relógio G", value: 200 },
    });
    const { trade_in_item_id: tiId } = await db.one<{ trade_in_item_id: string }>(
      "select trade_in_item_id from sales where id = $1",
      [sale.sale_id]
    );
    // gerente define preço e revende o seminovo antes do cancelamento
    await db.q("update items set sale_price = 250 where id = $1", [tiId]);
    await sell(db, ids.seller2, { items: [{ item_id: tiId, quantity: 1 }], key: crypto.randomUUID() });

    const hint = await hintOf(db.asUser(ids.manager, (c) => c.query("select public.cancel_sale($1, 'cliente desistiu')", [sale.sale_id])));
    expect(hint).toBe("TRADE_IN_ALREADY_SOLD");
    expect(await stockOf(db, item)).toBe(4); // a venda original continua de pé
  });
});
