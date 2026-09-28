import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addItem, createTestDb, hintOf, ids, type TestDb } from "./helpers";

/**
 * Fornecedor na entrada de estoque: a primeira "compra" de um item pede o fornecedor; a partir
 * daí o próprio item lembra (items.supplier_id) e as próximas entradas não perguntam de novo.
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
    c.query("select public.create_movement('entrada', $1, 1, $2, null, null, null, null, $3) as r", [item, subtype, supplier])
  );

describe("seed de fornecedores", () => {
  it("já vêm cadastrados EUA, EUROPA, PRG e SP", async () => {
    const rows = await db.q<{ name: string }>("select name from suppliers order by name");
    expect(rows.map((r) => r.name).sort()).toEqual(["EUA", "EUROPA", "PRG", "SP"]);
  });
});

describe("fornecedor na entrada de estoque", () => {
  it("compra sem fornecedor (item novo, nunca informado) é recusada", async () => {
    const item = await addItem(db, { name: "Relógio X" });
    expect(await hintOf(enter(item, "compra", null))).toBe("SUPPLIER_REQUIRED");
  });

  it("informado uma vez, o item lembra e a próxima compra não pede de novo", async () => {
    const item = await addItem(db, { name: "Relógio Y" });
    const sp = await supplierId("SP");
    await enter(item, "compra", sp);

    const row = await db.one<{ supplier_id: string }>("select supplier_id from items where id = $1", [item]);
    expect(row.supplier_id).toBe(sp);

    // segunda entrada, sem informar fornecedor — não é mais obrigatório
    await expect(enter(item, "compra", null)).resolves.toBeTruthy();
  });

  it("trocar o fornecedor numa entrada nova atualiza o que fica lembrado", async () => {
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

  it("transferência/devolução não exigem fornecedor mesmo sem ter sido informado antes", async () => {
    const item = await addItem(db, { name: "Relógio V" });
    await expect(enter(item, "transferencia", null)).resolves.toBeTruthy();
    await expect(enter(item, "devolucao", null)).resolves.toBeTruthy();
  });
});
