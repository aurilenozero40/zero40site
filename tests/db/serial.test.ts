import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, hintOf, ids, type TestDb } from "./helpers";

/**
 * Rastreamento por número de série (IMEI etc.): bipa o código de barras do produto e depois
 * o número de série — tanto na entrada de estoque quanto na venda. Cada unidade física vira
 * uma linha em item_serials; items.quantity continua sendo a única fonte de saldo.
 */
let db: TestDb;
let supplier: string;
beforeAll(async () => {
  db = await createTestDb("upgrade");
  supplier = (await db.one<{ id: string }>("select id from suppliers limit 1")).id;
});
afterAll(async () => {
  await db.close();
});

async function addSerialItem(name: string, price = 100): Promise<string> {
  const row = await db.one<{ id: string }>(
    "insert into items (name, sale_price, track_serial, created_by) values ($1, $2, true, $3) returning id",
    [name, price, ids.admin]
  );
  return row.id;
}

const enter = (user: string, item: string, serials: string[]) =>
  db.asUser(user, (c) =>
    c.query("select public.create_movement('entrada', $1, null, 'compra', null, 'nota fiscal', null, $2::jsonb, $3) as r", [
      item,
      JSON.stringify(serials),
      supplier,
    ])
  );

const statusOf = async (serial: string) => {
  const rows = await db.q<{ status: string; sale_item_id: string | null }>(
    "select status, sale_item_id from item_serials where serial = $1",
    [serial]
  );
  return rows[0];
};

describe("entrada de estoque com número de série", () => {
  it("cadastra um item_serials 'estoque' por serial bipado e soma a quantidade", async () => {
    const item = await addSerialItem("Rastreador A");
    const r = await enter(ids.manager, item, ["IMEI-001", "IMEI-002"]);
    expect((r.rows[0].r as { quantity: number }).quantity).toBe(2);

    const [rowA, rowB] = await Promise.all([statusOf("IMEI-001"), statusOf("IMEI-002")]);
    expect(rowA.status).toBe("estoque");
    expect(rowB.status).toBe("estoque");
    const item2 = await db.one<{ quantity: string }>("select quantity from items where id = $1", [item]);
    expect(Number(item2.quantity)).toBe(2);
  });

  it("recusa serial repetido (já existe em qualquer produto)", async () => {
    const item = await addSerialItem("Rastreador B");
    await enter(ids.manager, item, ["IMEI-DUP"]);
    expect(await hintOf(enter(ids.manager, item, ["IMEI-DUP"]))).toBe("SERIAL_DUPLICATE");
  });

  it("recusa entrada sem número de série quando o item usa serial", async () => {
    const item = await addSerialItem("Rastreador C");
    expect(await hintOf(enter(ids.manager, item, []))).toBe("SERIALS_REQUIRED");
  });
});

describe("saída manual com número de série", () => {
  it("baixa exatamente as unidades escolhidas e recusa serial que não está em estoque", async () => {
    const item = await addSerialItem("Rastreador D");
    await enter(ids.manager, item, ["IMEI-D1", "IMEI-D2"]);

    await db.asUser(ids.manager, (c) =>
      c.query("select public.create_movement('saida', $1, null, 'perda', null, 'quebrou', null, $2::jsonb)", [
        item,
        JSON.stringify(["IMEI-D1"]),
      ])
    );
    expect((await statusOf("IMEI-D1")).status).toBe("baixado");
    expect((await statusOf("IMEI-D2")).status).toBe("estoque");
    const item2 = await db.one<{ quantity: string }>("select quantity from items where id = $1", [item]);
    expect(Number(item2.quantity)).toBe(1);

    const hint = await hintOf(
      db.asUser(ids.manager, (c) =>
        c.query("select public.create_movement('saida', $1, null, 'perda', null, 'sumiu', null, $2::jsonb)", [
          item,
          JSON.stringify(["IMEI-D1"]), // já baixado, não está mais 'estoque'
        ])
      )
    );
    expect(hint).toBe("SERIAL_NOT_AVAILABLE");
  });
});

describe("venda com número de série", () => {
  it("vende bipando o serial, marca 'vendido' e vincula ao item da venda", async () => {
    const item = await addSerialItem("Rastreador E");
    await enter(ids.manager, item, ["IMEI-E1"]);

    const r = await db.asUser(ids.seller, (c) =>
      c.query(
        "select public.create_sale($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as r",
        [
          crypto.randomUUID(),
          null,
          JSON.stringify([{ item_id: item, quantity: 1, serials: ["IMEI-E1"] }]),
          0,
          "pix",
          1,
          0,
          null,
          null,
        ]
      )
    );
    expect((r.rows[0].r as { total: number }).total).toBe(100);

    const row = await statusOf("IMEI-E1");
    expect(row.status).toBe("vendido");
    expect(row.sale_item_id).not.toBeNull();
  });

  it("recusa vender sem bipar o serial (quantidade não confere) e serial já vendido/inexistente", async () => {
    const item = await addSerialItem("Rastreador F");
    await enter(ids.manager, item, ["IMEI-F1"]);

    const sellWith = (serials: string[]) =>
      db.asUser(ids.seller, (c) =>
        c.query("select public.create_sale($1,$2,$3::jsonb,0,'pix',1,0,null,null) as r", [
          crypto.randomUUID(),
          null,
          JSON.stringify([{ item_id: item, quantity: 1, serials }]),
        ])
      );

    expect(await hintOf(sellWith([]))).toBe("SERIAL_COUNT_MISMATCH");
    expect(await hintOf(sellWith(["IMEI-NAO-EXISTE"]))).toBe("SERIAL_NOT_AVAILABLE");
  });

  it("produto sem track_serial recusa serial no carrinho", async () => {
    const row = await db.one<{ id: string }>(
      "insert into items (name, sale_price, created_by) values ('Sem serial', 50, $1) returning id",
      [ids.admin]
    );
    await db.asUser(ids.manager, (c) =>
      c.query("select public.create_movement('entrada', $1, 5, 'compra', null, null, null, null, $2)", [row.id, supplier])
    );
    const hint = await hintOf(
      db.asUser(ids.seller, (c) =>
        c.query("select public.create_sale($1,$2,$3::jsonb,0,'pix',1,0,null,null) as r", [
          crypto.randomUUID(),
          null,
          JSON.stringify([{ item_id: row.id, quantity: 1, serials: ["X"] }]),
        ])
      )
    );
    expect(hint).toBe("SERIAL_NOT_APPLICABLE");
  });
});

describe("cancelamento e devolução devolvem o serial ao estoque", () => {
  it("cancelar a venda volta o serial para 'estoque'", async () => {
    const item = await addSerialItem("Rastreador G");
    await enter(ids.manager, item, ["IMEI-G1"]);
    const sale = await db.asUser(ids.seller, (c) =>
      c.query("select public.create_sale($1,$2,$3::jsonb,0,'pix',1,0,null,null) as r", [
        crypto.randomUUID(),
        null,
        JSON.stringify([{ item_id: item, quantity: 1, serials: ["IMEI-G1"] }]),
      ])
    );
    const saleId = (sale.rows[0].r as { sale_id: string }).sale_id;

    await db.asUser(ids.manager, (c) => c.query("select public.cancel_sale($1, 'cliente desistiu')", [saleId]));
    const row = await statusOf("IMEI-G1");
    expect(row.status).toBe("estoque");
    expect(row.sale_item_id).toBeNull();
  });

  it("devolução parcial só solta o serial escolhido; o outro continua vendido", async () => {
    const item = await addSerialItem("Rastreador H");
    await enter(ids.manager, item, ["IMEI-H1", "IMEI-H2"]);
    const sale = await db.asUser(ids.seller, (c) =>
      c.query("select public.create_sale($1,$2,$3::jsonb,0,'pix',1,0,null,null) as r", [
        crypto.randomUUID(),
        null,
        JSON.stringify([{ item_id: item, quantity: 2, serials: ["IMEI-H1", "IMEI-H2"] }]),
      ])
    );
    const saleId = (sale.rows[0].r as { sale_id: string }).sale_id;
    const si = await db.one<{ id: string }>("select id from sale_items where sale_id = $1", [saleId]);

    await db.asUser(ids.manager, (c) =>
      c.query("select public.return_sale_items($1, $2::jsonb, 'defeito', $3)", [
        saleId,
        JSON.stringify([{ sale_item_id: si.id, quantity: 1, serials: ["IMEI-H1"] }]),
        crypto.randomUUID(),
      ])
    );

    expect((await statusOf("IMEI-H1")).status).toBe("estoque");
    expect((await statusOf("IMEI-H2")).status).toBe("vendido");
  });
});
