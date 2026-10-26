import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { addItem, createTestDb, hintOf, ids, sell, type TestDb } from "./helpers";

/**
 * Segunda rodada: custo e SKU obrigatórios, validação de número de série no servidor, marca/cliente
 * normalizados, desconto real separado do ajuste de parcelamento e entrada (troca) sem colidir nomes.
 */
let db: TestDb;
let supplier: string;
beforeAll(async () => {
  db = await createTestDb("upgrade");
  supplier = (await db.one<{ id: string }>("select id from suppliers where name = 'EUA'")).id;
});
afterAll(async () => {
  await db.close();
});

const serialItem = async (name: string) =>
  (
    await db.one<{ id: string }>(
      "insert into items (sku, name, track_serial, created_by) values (substr(gen_random_uuid()::text, 1, 10), $1, true, $2) returning id",
      [name, ids.admin]
    )
  ).id;

const enterSerials = (item: string, serials: string[], unitValue: number | null = 10) =>
  db.asUser(ids.manager, (c) =>
    c.query("select public.create_movement('entrada', $1, null, 'compra', $2, null, null, $3::jsonb, $4)", [item, unitValue, JSON.stringify(serials), supplier])
  );

const enterQty = (item: string, qty: number, unitValue: number | null) =>
  db.asUser(ids.manager, (c) => c.query("select public.create_movement('entrada', $1, $2, 'compra', $3, null, null, null, $4)", [item, qty, unitValue, supplier]));

describe("custo obrigatório", () => {
  it("compra sem custo (ou custo 0) é recusada no servidor; com custo passa e fica gravado", async () => {
    const item = await addItem(db, { name: "Custo obrigatório" });
    expect(await hintOf(enterQty(item, 1, null))).toBe("COST_REQUIRED");
    expect(await hintOf(enterQty(item, 1, 0))).toBe("COST_REQUIRED");
    await enterQty(item, 2, 35.5);
    const row = await db.one<{ cost_price: string; quantity: string }>("select cost_price, quantity from items where id = $1", [item]);
    expect(Number(row.cost_price)).toBe(35.5);
    expect(Number(row.quantity)).toBe(2);
  });

  it("produto ativo com estoque e sem custo não pode ser editado até informar o custo", async () => {
    const item = await addItem(db, { name: "Sem custo com estoque", stock: 3 }); // addItem dá estoque direto no ledger, sem custo
    expect(await hintOf(db.q("update items set name = 'SEM CUSTO RENOMEADO' where id = $1", [item]))).toBe("COST_REQUIRED");
    await db.q("update items set cost_price = 12, name = 'SEM CUSTO RENOMEADO' where id = $1", [item]);
    expect((await db.one<{ name: string }>("select name from items where id = $1", [item])).name).toBe("SEM CUSTO RENOMEADO");
  });
});

describe("SKU obrigatório para produto ativo", () => {
  it("não cadastra nem ativa produto ativo sem SKU; inativo pode ficar sem", async () => {
    expect(await hintOf(db.q("insert into items (name, created_by) values ('Sem sku', $1)", [ids.admin]))).toBe("SKU_REQUIRED");
    const [inactive] = await db.q<{ id: string }>("insert into items (name, active, created_by) values ('Inativo sem sku', false, $1) returning id", [ids.admin]);
    expect(await hintOf(db.q("update items set active = true where id = $1", [inactive.id]))).toBe("SKU_REQUIRED");
    await db.q("update items set sku = 'COM-SKU-1', active = true where id = $1", [inactive.id]);
  });
});

describe("número de série validado no servidor", () => {
  it("recusa serial curto, com espaço e igual ao código de barras/SKU de um produto", async () => {
    const watch = await serialItem("Relógio de série A");
    await addItem(db, { name: "Outro produto", barcode: "753759999000" });
    const other = await db.one<{ sku: string }>("select sku from items where barcode = '753759999000'");

    expect(await hintOf(enterSerials(watch, ["ab"]))).toBe("SERIAL_INVALID");
    expect(await hintOf(enterSerials(watch, ["AB CD 1234"]))).toBe("SERIAL_INVALID");
    expect(await hintOf(enterSerials(watch, ["753759999000"]))).toBe("SERIAL_IS_PRODUCT_CODE"); // barcode de outro produto
    expect(await hintOf(enterSerials(watch, [other.sku.toLowerCase()]))).toBe("SERIAL_IS_PRODUCT_CODE"); // SKU, qualquer caixa
    expect(Number((await db.one<{ quantity: string }>("select quantity from items where id = $1", [watch])).quantity)).toBe(0);

    await enterSerials(watch, ["3AB9X21P0Q"]);
    expect(Number((await db.one<{ quantity: string }>("select quantity from items where id = $1", [watch])).quantity)).toBe(1);
  });

  it("recusa serial repetido no banco (em qualquer produto) e repetido na própria lista", async () => {
    const a = await serialItem("Série B1");
    const b = await serialItem("Série B2");
    await enterSerials(a, ["REPETIDO-001"]);
    expect(await hintOf(enterSerials(b, ["REPETIDO-001"]))).toBe("SERIAL_DUPLICATE");
    expect(await hintOf(enterSerials(b, ["NOVO-0001", "NOVO-0001"]))).toBe("SERIAL_DUPLICATE");
  });
});

describe("marca e cliente normalizados", () => {
  it("'Garmin' e 'GARMIN' viram a mesma marca; categoria sem espaços sobrando", async () => {
    const [a] = await db.q<{ id: string }>("insert into items (sku, name, manufacturer, category, created_by) values (substr(gen_random_uuid()::text,1,10), 'Marca A', ' Garmin ', '  GPS  ', $1) returning id", [ids.admin]);
    const [b] = await db.q<{ id: string }>("insert into items (sku, name, manufacturer, created_by) values (substr(gen_random_uuid()::text,1,10), 'Marca B', 'GARMIN', $1) returning id", [ids.admin]);
    const rows = await db.q<{ manufacturer: string; category: string | null }>("select manufacturer, category from items where id = any($1) order by name", [[a.id, b.id]]);
    expect(rows[0]).toEqual({ manufacturer: "GARMIN", category: "GPS" });
    expect(rows[1].manufacturer).toBe("GARMIN");
  });

  it("nome de cliente: sem espaços sobrando e em caixa alta", async () => {
    const [c] = await db.q<{ name: string }>("insert into customers (name, created_by) values ('  paulo   kleverman alencar ', $1) returning name", [ids.admin]);
    expect(c.name).toBe("PAULO KLEVERMAN ALENCAR");
  });
});

describe("desconto real x ajuste de parcelamento (dashboard)", () => {
  it("KPI de descontos só soma desconto SEM juros; nas vendas com juros mostra o juros líquido", async () => {
    const d = await createTestDb("upgrade");
    const mk = (subtotal: number, discount: number, interest: number, at: string) =>
      d.q(
        `insert into sales (idempotency_key, seller_id, created_by, subtotal, discount_amount, interest_amount, total, created_at)
         values (gen_random_uuid(), $1, $1, $2::numeric, $3::numeric, $4::numeric, $2::numeric - $3::numeric + $4::numeric, $5)`,
        [ids.seller, subtotal, discount, interest, at]
      );
    await mk(8399, 1000, 0, "2026-10-10T15:00:00Z"); // desconto real (#VND-000019)
    await mk(1799, 4.22, 269.22, "2026-10-11T15:00:00Z"); // parcelado: resíduo de arredondamento + juros
    await mk(2490, 0.18, 79.18, "2026-10-12T15:00:00Z");
    const r = await d.asUser(ids.manager, async (c) => (await c.query("select public.sales_dashboard('2026-10-01Z','2026-11-01Z') r")).rows[0].r);
    expect(Number(r.discounts)).toBe(1000); // sem os R$ 4,22 e R$ 0,18
    expect(Number(r.interest)).toBeCloseTo(265 + 79, 2); // (269,22 − 4,22) + (79,18 − 0,18)
    await d.close();
  });
});

describe("entrada (troca) na venda", () => {
  it("o produto recebido ganha SKU próprio e não colide com produto ativo de mesmo nome", async () => {
    const sold = await addItem(db, { name: "Produto vendido", price: 1000, stock: 2, cost: 500 });
    await addItem(db, { name: "Relogio usado de troca", price: 100, cost: 50 }); // já existe um ativo com o nome da troca
    const sale = await sell(db, ids.seller, { items: [{ item_id: sold, quantity: 1 }], tradeIn: { item_name: "Relogio usado de troca", category: "Relógios", value: 200 } });
    const ti = await db.one<{ name: string; sku: string; active: boolean }>(
      "select i.name, i.sku, i.active from sales s join items i on i.id = s.trade_in_item_id where s.id = $1",
      [sale.sale_id]
    );
    expect(ti.sku).toBe(`TROCA-${sale.code}`);
    expect(ti.name).toBe(`RELOGIO USADO DE TROCA (ENTRADA ${sale.code})`);
    expect(ti.active).toBe(true);
  });
});

describe("venda e entrada sem Telegram configurado", () => {
  it("a venda grava normalmente e o aviso fica pendente na fila (nada trava)", async () => {
    const item = await addItem(db, { name: "Sem telegram", price: 50, stock: 2, cost: 20 });
    const sale = await sell(db, ids.seller, { key: crypto.randomUUID(), items: [{ item_id: item, quantity: 1 }] });
    expect(sale.status).toBe("concluida");
    const ev = await db.q<{ status: string }>("select status from notification_outbox where entity_id = $1", [sale.sale_id]);
    expect(ev.map((e) => e.status)).toEqual(["pending"]);
    await enterQty(item, 1, 20); // entrada também não depende do Telegram
    expect(Number((await db.one<{ quantity: string }>("select quantity from items where id = $1", [item])).quantity)).toBe(2);
  });
});
