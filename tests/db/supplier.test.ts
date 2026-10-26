import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { addItem, createTestDb, hintOf, ids, type TestDb } from "./helpers";

/**
 * Fornecedor é uma informação da NOTA (e fica gravado na movimentação de entrada):
 * "Compra" exige fornecedor sempre; devolução/transferência/outros não. O fornecedor
 * placeholder (is_placeholder, marcado à mão) nunca vale como fornecedor real; "INVENTARIO" (estoque em casa) vale.
 */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

const supplierId = async (name: string) => (await db.one<{ id: string }>("select id from suppliers where name = $1", [name])).id;

const enter = (item: string, subtype: string, supplier: string | null) =>
  db.asUser(ids.manager, (c) =>
    c.query("select public.create_movement('entrada', $1, 1, $2, 10, null, null, null, $3) as r", [item, subtype, supplier])
  );

const enterWithValue = (item: string, subtype: string, unitValue: number | null, supplier: string | null) =>
  db.asUser(ids.manager, (c) =>
    c.query("select public.create_movement('entrada', $1, 1, $2, $3, null, null, null, $4) as r", [item, subtype, unitValue, supplier])
  );

const note = (items: unknown[], opts: { supplier?: string | null; key?: string | null; subtype?: string } = {}) =>
  db.asUser(
    ids.manager,
    async (c) =>
      (await c.query("select public.create_stock_entry($1::jsonb, $2, null, $3, $4) as r", [JSON.stringify(items.map((i) => ({ unit_value: 10, ...(i as object) }))), opts.subtype ?? "compra", opts.supplier ?? null, opts.key ?? null])).rows[0]
        .r as { count: number; already_processed?: boolean }
  );

describe("seed de fornecedores", () => {
  it("já vêm cadastrados EUA, EUROPA, PRG e SP", async () => {
    const rows = await db.q<{ name: string }>("select name from suppliers where not is_placeholder order by name");
    expect(rows.map((r) => r.name).sort()).toEqual(["EUA", "EUROPA", "PRG", "SP"]);
  });

  it("INVENTARIO (estoque em casa) é uma origem VÁLIDA: o schema nunca o marca como placeholder e a compra aceita", async () => {
    const d = await createTestDb("upgrade");
    const inv = await d.one<{ id: string; is_placeholder: boolean }>("insert into suppliers (name) values ('INVENTARIO') returning id, is_placeholder");
    expect(inv.is_placeholder).toBe(false);
    const item = await addItem(d, { name: "Estoque em casa" });
    await d.asUser(ids.manager, (c) => c.query("select public.create_movement('entrada', $1, 1, 'compra', 10, null, null, null, $2)", [item, inv.id]));
    const m = await d.one<{ supplier_id: string }>("select supplier_id from movements where item_id = $1 and subtype = 'compra'", [item]);
    expect(m.supplier_id).toBe(inv.id);
    await d.close();
  });
});

describe("fornecedor na entrada de estoque", () => {
  it("compra sem fornecedor é recusada — sempre, mesmo em produto que já teve fornecedor", async () => {
    const item = await addItem(db, { name: "Relógio X" });
    expect(await hintOf(enter(item, "compra", null))).toBe("SUPPLIER_REQUIRED");

    const sp = await supplierId("SP");
    await enter(item, "compra", sp);
    expect(await hintOf(enter(item, "compra", null))).toBe("SUPPLIER_REQUIRED"); // o item NÃO "lembra" mais
  });

  it("o fornecedor escolhido fica gravado na própria movimentação de entrada", async () => {
    const item = await addItem(db, { name: "Relógio Y" });
    const sp = await supplierId("SP");
    await enter(item, "compra", sp);
    const m = await db.one<{ supplier_id: string }>("select supplier_id from movements where item_id = $1 and subtype = 'compra'", [item]);
    expect(m.supplier_id).toBe(sp);
  });

  it("fornecedor placeholder (INVENTARIO) é recusado em compra nova", async () => {
    const item = await addItem(db, { name: "Relógio P" });
    const ph = await db.one<{ id: string }>("insert into suppliers (name, is_placeholder) values ('INVENTARIO-T', true) returning id");
    expect(await hintOf(enter(item, "compra", ph.id))).toBe("SUPPLIER_PLACEHOLDER");
    expect(await hintOf(enter(item, "transferencia", ph.id))).toBe("SUPPLIER_PLACEHOLDER");
  });

  it("trocar o fornecedor numa entrada nova atualiza o último fornecedor do produto", async () => {
    const item = await addItem(db, { name: "Relógio Z" });
    const sp = await supplierId("SP");
    const eua = await supplierId("EUA");
    await enter(item, "compra", sp);
    await enter(item, "compra", eua);

    const row = await db.one<{ supplier_id: string }>("select supplier_id from items where id = $1", [item]);
    expect(row.supplier_id).toBe(eua);
  });

  it("recusa fornecedor inexistente", async () => {
    const item = await addItem(db, { name: "Relógio W" });
    expect(await hintOf(enter(item, "compra", "00000000-0000-0000-0000-000000000000"))).toBe("SUPPLIER_NOT_FOUND");
  });

  it("transferência/devolução não exigem fornecedor", async () => {
    const item = await addItem(db, { name: "Relógio V" });
    await expect(enter(item, "transferencia", null)).resolves.toBeTruthy();
    await expect(enter(item, "devolucao", null)).resolves.toBeTruthy();
  });
});

describe("nota de entrada: fornecedor único para todos os itens", () => {
  it("3 itens, 1 fornecedor da nota: os 3 movimentos gravam o mesmo fornecedor", async () => {
    const a = await addItem(db, { name: "Nota 1" });
    const b = await addItem(db, { name: "Nota 2" });
    const c = await addItem(db, { name: "Nota 3" });
    const eua = await supplierId("EUA");
    const r = await note([{ item_id: a, quantity: 2 }, { item_id: b, quantity: 1 }, { item_id: c, quantity: 5 }], { supplier: eua });
    expect(r.count).toBe(3);
    const rows = await db.q<{ supplier_id: string }>("select supplier_id from movements where item_id = any($1) and subtype = 'compra'", [[a, b, c]]);
    expect(rows).toHaveLength(3);
    expect(rows.every((m) => m.supplier_id === eua)).toBe(true);
  });

  it("nota de compra sem fornecedor falha inteira (nada é gravado)", async () => {
    const a = await addItem(db, { name: "Nota sem forn" });
    expect(await hintOf(note([{ item_id: a, quantity: 2 }]))).toBe("SUPPLIER_REQUIRED");
    expect(Number((await db.one<{ quantity: string }>("select quantity from items where id = $1", [a])).quantity)).toBe(0);
  });

  it("devolução/transferência/outros passam sem fornecedor", async () => {
    const a = await addItem(db, { name: "Nota dev" });
    for (const subtype of ["devolucao", "transferencia", "outros"]) {
      await expect(note([{ item_id: a, quantity: 1 }], { subtype })).resolves.toMatchObject({ count: 1 });
    }
  });

  it("clique duplo: a mesma chave de idempotência não registra a nota duas vezes", async () => {
    const a = await addItem(db, { name: "Nota idem" });
    const eua = await supplierId("EUA");
    const key = crypto.randomUUID();
    const [r1, r2] = await Promise.all([
      note([{ item_id: a, quantity: 3 }], { supplier: eua, key }),
      note([{ item_id: a, quantity: 3 }], { supplier: eua, key }),
    ]);
    expect([r1.already_processed, r2.already_processed].filter(Boolean)).toHaveLength(1);
    expect(Number((await db.one<{ quantity: string }>("select quantity from items where id = $1", [a])).quantity)).toBe(3);
    expect(Number((await db.one<{ n: string }>("select count(*) n from movements where item_id = $1", [a])).n)).toBe(1);
  });
});

describe("Reposição agrupa pelo ÚLTIMO fornecedor real", () => {
  const rows = () =>
    db.asUser(
      ids.manager,
      async (c) => (await c.query("select id, supplier_id, supplier_name from public.stock_alert_rows()")).rows as { id: string; supplier_id: string | null; supplier_name: string | null }[]
    );

  it("usa o fornecedor da compra mais recente; sem compra real, 'sem fornecedor'", async () => {
    const used = await addItem(db, { name: "Rep com compra", min: 10 });
    const never = await addItem(db, { name: "Rep sem compra", min: 10 });
    const sp = await supplierId("SP");
    const eua = await supplierId("EUA");
    await enter(used, "compra", sp);
    await enter(used, "compra", eua);

    const r = await rows();
    expect(r.find((x) => x.id === used)!.supplier_id).toBe(eua);
    expect(r.find((x) => x.id === never)!.supplier_id).toBeNull();
  });

  it("INVENTARIO nunca vira o fornecedor da Reposição, nem pelo cadastro do produto", async () => {
    const ph = await db.one<{ id: string }>("insert into suppliers (name, is_placeholder) values ('INVENTARIO-R', true) returning id");
    const item = await addItem(db, { name: "Rep placeholder", min: 5 });
    await db.q("update items set supplier_id = $1 where id = $2", [ph.id, item]);
    const r = await rows();
    expect(r.find((x) => x.id === item)!.supplier_id).toBeNull();
  });
});

describe("custo na entrada de estoque (compra)", () => {
  it("compra com valor unitário grava em items.cost_price — a próxima entrada já vem com esse valor pré-preenchido", async () => {
    const item = await addItem(db, { name: "Relógio Custo A" });
    const sp = await supplierId("SP");
    await enterWithValue(item, "compra", 150.5, sp);
    const row = await db.one<{ cost_price: string }>("select cost_price from items where id = $1", [item]);
    expect(Number(row.cost_price)).toBe(150.5);
  });

  it("comprar de novo com valor diferente atualiza o custo lembrado", async () => {
    const item = await addItem(db, { name: "Relógio Custo B" });
    const sp = await supplierId("SP");
    await enterWithValue(item, "compra", 100, sp);
    await enterWithValue(item, "compra", 120, sp);
    const row = await db.one<{ cost_price: string }>("select cost_price from items where id = $1", [item]);
    expect(Number(row.cost_price)).toBe(120);
  });

  it("devolução/transferência não mexem no custo lembrado (não é um preço de compra novo)", async () => {
    const item = await addItem(db, { name: "Relógio Custo C" });
    const sp = await supplierId("SP");
    await enterWithValue(item, "compra", 200, sp);
    await enterWithValue(item, "devolucao", 1, null);
    await enterWithValue(item, "transferencia", 999, null);
    const row = await db.one<{ cost_price: string }>("select cost_price from items where id = $1", [item]);
    expect(Number(row.cost_price)).toBe(200);
  });
});
