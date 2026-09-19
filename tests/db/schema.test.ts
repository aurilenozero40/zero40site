import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { addItem, createTestDb, hintOf, ids, sell, stockOf, type TestDb } from "./helpers";

const schema = fs.readFileSync(path.resolve(__dirname, "..", "..", "supabase", "schema.sql"), "utf8");

describe.each(["upgrade", "fresh"] as const)("schema.sql — %s", (template) => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb(template);
  });
  afterAll(async () => {
    await db.close();
  });

  it("roda de novo sem erro (idempotente) e não perde dados", async () => {
    const item = await addItem(db, { name: "Relógio", stock: 5 });
    const before = await db.one<{ i: string; m: string; e: string }>(
      "select (select count(*) from items) i, (select count(*) from movements) m, (select count(*) from employees) e"
    );
    await db.su.query(schema);
    await db.su.query(schema);
    const after = await db.one<{ i: string; m: string; e: string }>(
      "select (select count(*) from items) i, (select count(*) from movements) m, (select count(*) from employees) e"
    );
    expect(after).toEqual(before);
    expect(await stockOf(db, item)).toBe(5);
  });

  it("usuário novo entra como vendedor", async () => {
    await db.su.query("insert into auth.users (id, email) values (gen_random_uuid(), 'novo@loja.com')");
    const novo = await db.one<{ role: string }>("select role from employees where full_name = 'novo@loja.com'");
    expect(novo.role).toBe("vendedor");
  });

  it("vende ponta a ponta (venda + estoque + auditoria + evento)", async () => {
    const item = await addItem(db, { name: "Garmin 55 Preto", price: 1000, stock: 3, barcode: "753759279608" });
    const r = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }] });
    expect(r.code).toMatch(/^VND-\d{6}$/);
    expect(await stockOf(db, item)).toBe(1);
    const ev = await db.q("select event_type, status from notification_outbox where event_type = 'SALE_COMPLETED'");
    expect(ev).toHaveLength(1);
    expect(ev[0].status).toBe("pending");
  });

  it("view de resumo não é legível sem login", async () => {
    const rows = await db.asAnon(async (c) => {
      try {
        return (await c.query("select * from monthly_movement_summary")).rows;
      } catch (e) {
        return "denied:" + (e as { code?: string }).code;
      }
    });
    expect(rows === "denied:42501" || (Array.isArray(rows) && rows.length === 0)).toBe(true);
  });

  it("registrar venda sem chave de idempotência é recusado", async () => {
    const item = await addItem(db, { name: "X", stock: 1 });
    const hint = await hintOf(
      db.asUser(ids.seller, (c) =>
        c.query("select public.create_sale(null, null, $1::jsonb)", [JSON.stringify([{ item_id: item, quantity: 1 }])])
      )
    );
    expect(hint).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("schema.sql — atualização do estado antigo de produção", () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb("upgrade");
  });
  afterAll(async () => {
    await db.close();
  });

  it("admins existentes continuam admin", async () => {
    const admins = await db.q("select id from employees where role = 'admin' order by id");
    expect(admins.map((a) => a.id)).toEqual([
      "00000000-0000-0000-0000-0000000000a1",
      "00000000-0000-0000-0000-0000000000a2",
    ]);
  });

  it("papéis legados (staff/operador) viram vendedor", async () => {
    const c = await db.connect();
    await c.query("alter table employees drop constraint employees_role_check");
    await c.query("update employees set role = 'staff' where id = $1", [ids.seller]);
    await c.query("update employees set role = 'operador' where id = $1", [ids.seller2]);
    await c.query(schema);
    await c.end();
    const rows = await db.q<{ role: string }>("select role from employees where id in ($1,$2)", [
      ids.seller,
      ids.seller2,
    ]);
    expect(rows.every((r) => r.role === "vendedor")).toBe(true);
  });

  it("as correções da create_sale entram em cima da versão que está em produção", async () => {
    const item = await addItem(db, { name: "Y", stock: 2 });
    // versão antiga deixava passar forma de pagamento nula; a nova recusa com código claro
    const hint = await hintOf(
      db.asUser(ids.seller, (c) =>
        c.query("select public.create_sale(gen_random_uuid(), null, $1::jsonb, 0, null)", [
          JSON.stringify([{ item_id: item, quantity: 1 }]),
        ])
      )
    );
    expect(hint).toBe("INVALID_PAYMENT");
  });
});
