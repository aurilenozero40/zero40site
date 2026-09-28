import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { addItem, createTestDb, hintOf, ids, sell, stockOf, type TestDb } from "./helpers";

let db: TestDb;
let supplier: string;
beforeAll(async () => {
  db = await createTestDb("upgrade");
  supplier = (await db.one<{ id: string }>("select id from suppliers limit 1")).id;
});
afterAll(async () => {
  await db.close();
});

/** Código SQLSTATE do erro (ou "ok" se não falhou). */
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { code?: string }).code ?? (e as Error).message;
  }
};
const DENIED = "42501"; // permission denied / RLS violation

describe("estoque só muda pelo ledger", () => {
  it("ninguém altera items.quantity direto — nem vendedor, nem gerente, nem admin", async () => {
    const item = await addItem(db, { name: "Protegido", stock: 5 });
    for (const user of [ids.seller, ids.manager, ids.admin, ids.ceo]) {
      const code = await codeOf(db.asUser(user, (c) => c.query("update items set quantity = 999 where id = $1", [item])));
      expect(code).toBe(DENIED);
    }
    expect(await stockOf(db, item)).toBe(5);
  });

  it("nem no cadastro: gerente não consegue criar produto já com estoque", async () => {
    const code = await codeOf(
      db.asUser(ids.manager, (c) => c.query("insert into items (name, quantity, sale_price) values ('Com estoque', 50, 10)"))
    );
    expect(code).toBe(DENIED);
    const ok = await codeOf(
      db.asUser(ids.manager, (c) => c.query("insert into items (name, sale_price) values ('Sem estoque', 10)"))
    );
    expect(ok).toBe("ok");
  });

  it("o piso do estoque: movimentação que deixaria negativo é barrada pelo próprio banco", async () => {
    const item = await addItem(db, { name: "Piso", stock: 2 });
    const err = await db
      .q("insert into movements (item_id, type, subtype, quantity, created_by) values ($1, 'saida', 'perda', 3, $2)", [item, ids.admin])
      .catch((e: Error) => e.message);
    expect(String(err)).toContain("items_quantity_not_negative");
    expect(await stockOf(db, item)).toBe(2);
  });
});

describe("preço e cadastro: só gerente+", () => {
  it("vendedor não altera nem cadastra produto; gerente sim", async () => {
    const item = await addItem(db, { name: "Preço fixo", price: 100, stock: 1 });

    const upd = await db.asUser(ids.seller, (c) => c.query("update items set sale_price = 1 where id = $1", [item]));
    expect(upd.rowCount).toBe(0); // RLS filtra: nenhuma linha
    expect(Number((await db.one<{ sale_price: string }>("select sale_price from items where id = $1", [item])).sale_price)).toBe(100);

    expect(
      await codeOf(db.asUser(ids.seller, (c) => c.query("insert into items (name, sale_price) values ('Invasor', 1)")))
    ).toBe(DENIED);

    const mgr = await db.asUser(ids.manager, (c) => c.query("update items set sale_price = 120 where id = $1", [item]));
    expect(mgr.rowCount).toBe(1);
  });

  it("só admin/ceo apaga produto (e produto com histórico nem assim)", async () => {
    const fresh = await addItem(db, { name: "Apagável", stock: 0 });
    const mgr = await db.asUser(ids.manager, (c) => c.query("delete from items where id = $1", [fresh]));
    expect(mgr.rowCount).toBe(0);
    const adm = await db.asUser(ids.admin, (c) => c.query("delete from items where id = $1", [fresh]));
    expect(adm.rowCount).toBe(1);

    const withHistory = await addItem(db, { name: "Com histórico", stock: 3 });
    expect(await codeOf(db.asUser(ids.admin, (c) => c.query("delete from items where id = $1", [withHistory])))).toBe("23001"); // restrict_violation
  });

  it("mudar preço gera auditoria com antes/depois e quem fez", async () => {
    const item = await addItem(db, { name: "Auditado", price: 100, cost: 60, stock: 1 });
    await db.asUser(ids.manager, (c) => c.query("update items set sale_price = 150 where id = $1", [item]));
    const log = await db.one<{ action: string; actor_id: string; actor_name: string; changes: Record<string, { old: unknown; new: unknown }> }>(
      "select * from audit_logs where entity_type = 'item' and entity_id = $1 and action = 'item.price_changed'",
      [item.toString()]
    );
    expect(log.actor_id).toBe(ids.manager);
    expect(log.actor_name).toBe("Marina Gerente");
    expect(Number(log.changes.sale_price.old)).toBe(100);
    expect(Number(log.changes.sale_price.new)).toBe(150);
  });

  it("desativar/reativar produto é auditado; mudar só o estoque NÃO polui a auditoria de produto", async () => {
    const item = await addItem(db, { name: "Ativo/inativo", stock: 2 });
    await db.asUser(ids.manager, (c) => c.query("update items set active = false where id = $1", [item]));
    const actions = (await db.q<{ action: string }>("select action from audit_logs where entity_id = $1 order by id", [item])).map((r) => r.action);
    expect(actions).toContain("item.deactivated");
    // as movimentações de estoque já estão no ledger; não duplicam em audit_logs
    expect(actions.filter((a) => a === "item.updated")).toHaveLength(0);
  });
});

describe("movimentações manuais", () => {
  // Toda movimentação manual (entrada/saída/ajuste) passa pela função create_movement — ela
  // confere perfil, coerência tipo×subtipo e nunca aceita subtype 'venda'/'cancelamento' à mão.
  const callMv = (user: string, item: string, type: string, subtype: string, reason: string | null = null, supplierId: string | null = null) =>
    db.asUser(user, (c) => c.query("select public.create_movement($1, $2, 1, $3, null, $4, null, null, $5)", [type, item, subtype, reason, supplierId]));

  it("vendedor não lança; gerente lança compra/perda; ninguém lança 'venda' ou 'cancelamento' à mão", async () => {
    const item = await addItem(db, { name: "Manual", stock: 5 });
    expect(await hintOf(callMv(ids.seller, item, "entrada", "compra"))).toBe("FORBIDDEN");
    expect(await codeOf(callMv(ids.manager, item, "entrada", "compra", null, supplier))).toBe("ok");
    expect(await codeOf(callMv(ids.manager, item, "saida", "perda", "quebrou"))).toBe("ok");
    expect(await hintOf(callMv(ids.manager, item, "saida", "venda"))).toBe("FORBIDDEN");
    expect(await hintOf(callMv(ids.manager, item, "entrada", "cancelamento"))).toBe("FORBIDDEN");
    expect(await hintOf(callMv(ids.admin, item, "saida", "venda"))).toBe("FORBIDDEN");
  });

  it("não dá para lançar em nome de outra pessoa: created_by é sempre quem está logado", async () => {
    const item = await addItem(db, { name: "Em nome de", stock: 5 });
    await callMv(ids.manager, item, "entrada", "compra", null, supplier);
    const [row] = await db.q<{ created_by: string }>(
      "select created_by from movements where item_id = $1 order by created_at desc limit 1",
      [item]
    );
    expect(row.created_by).toBe(ids.manager);
  });

  it("subtipo incoerente com o tipo é recusado (saída 'compra', entrada 'perda')", async () => {
    const item = await addItem(db, { name: "Coerência", stock: 5 });
    expect(await codeOf(callMv(ids.manager, item, "saida", "compra"))).toBe("23514");
    expect(await codeOf(callMv(ids.manager, item, "entrada", "perda"))).toBe("23514");
  });
});

describe("imutabilidade: histórico não se reescreve", () => {
  it("movimentação, auditoria e pagamento não aceitam UPDATE/DELETE (nem do superusuário)", async () => {
    const item = await addItem(db, { name: "Histórico", price: 10, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });

    expect(await hintOf(db.su.query("update movements set quantity = 99 where sale_id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("delete from movements where sale_id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("update audit_logs set action = 'x'"))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("delete from audit_logs"))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("update sale_payments set amount = 1 where sale_id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("delete from sale_payments where sale_id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
  });

  it("venda nunca é apagada; dados históricos (valores, vendedor, número) não mudam", async () => {
    const item = await addItem(db, { name: "Venda protegida", price: 100, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });

    expect(await hintOf(db.su.query("delete from sales where id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("update sales set total = 1, subtotal = 1 where id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("update sales set seller_id = $2 where id = $1", [sale.sale_id, ids.seller2]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("update sales set number = 999999 where id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("update sales set notes = 'reescrito' where id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("delete from sale_items where sale_id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
    expect(await hintOf(db.su.query("update sale_items set quantity = 9, unit_price = 1 where sale_id = $1", [sale.sale_id]))).toBe("IMMUTABLE");
  });

  it("usuários (mesmo admin) não escrevem direto em vendas, itens, pagamentos, auditoria e fila", async () => {
    const item = await addItem(db, { name: "Sem escrita direta", price: 100, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    for (const user of [ids.seller, ids.manager, ids.admin, ids.ceo]) {
      for (const sql of [
        `update sales set status = 'cancelada' where id = '${sale.sale_id}'`,
        `delete from sales where id = '${sale.sale_id}'`,
        `update sale_items set returned_quantity = 1 where sale_id = '${sale.sale_id}'`,
        `update sale_payments set amount = 1 where sale_id = '${sale.sale_id}'`,
        `insert into audit_logs (action, entity_type, entity_id) values ('falso', 'sale', 'x')`,
        `update audit_logs set action = 'x'`,
        `update notification_outbox set status = 'sent'`,
        `delete from movements`,
      ]) {
        expect(await codeOf(db.asUser(user, (c) => c.query(sql)))).toBe(DENIED);
      }
    }
  });
});

describe("cada perfil só enxerga o que deve", () => {
  it("vendedor vê só as próprias vendas (e itens/pagamentos delas); gerente e CEO veem todas", async () => {
    const item = await addItem(db, { name: "Visibilidade", price: 10, stock: 20 });
    const mine = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    const theirs = await sell(db, ids.seller2, { items: [{ item_id: item, quantity: 1 }] });

    const seeSales = (u: string) => db.asUser(u, async (c) => (await c.query("select id from sales where id in ($1,$2)", [mine.sale_id, theirs.sale_id])).rows.map((r) => r.id));
    expect(await seeSales(ids.seller)).toEqual([mine.sale_id]);
    expect((await seeSales(ids.seller2))).toEqual([theirs.sale_id]);
    expect((await seeSales(ids.manager)).sort()).toEqual([mine.sale_id, theirs.sale_id].sort());
    expect((await seeSales(ids.ceo)).sort()).toEqual([mine.sale_id, theirs.sale_id].sort());

    const otherItems = await db.asUser(ids.seller, (c) => c.query("select 1 from sale_items where sale_id = $1", [theirs.sale_id]));
    const otherPays = await db.asUser(ids.seller, (c) => c.query("select 1 from sale_payments where sale_id = $1", [theirs.sale_id]));
    expect(otherItems.rowCount).toBe(0);
    expect(otherPays.rowCount).toBe(0);
  });

  it("auditoria, fila de notificações e configurações: vendedor não vê; gerente vê auditoria/fila; só admin/ceo edita configuração", async () => {
    const item = await addItem(db, { name: "Painéis", price: 10, stock: 5 });
    await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    const n = (u: string, t: string) => db.asUser(u, async (c) => (await c.query(`select count(*)::int n from ${t}`)).rows[0].n as number);

    expect(await n(ids.seller, "audit_logs")).toBe(0);
    expect(await n(ids.seller, "notification_outbox")).toBe(0);
    expect(await n(ids.seller, "app_settings")).toBe(0);
    expect(await n(ids.manager, "audit_logs")).toBeGreaterThan(0);
    expect(await n(ids.manager, "notification_outbox")).toBeGreaterThan(0);
    expect(await n(ids.manager, "app_settings")).toBeGreaterThan(0);

    const upd = (u: string) => db.asUser(u, (c) => c.query("update app_settings set value = '5' where key = 'max_interest_percent'"));
    expect((await upd(ids.seller)).rowCount).toBe(0);
    expect((await upd(ids.manager)).rowCount).toBe(0);
    expect((await upd(ids.admin)).rowCount).toBe(1);
    await db.q("update app_settings set value = '50' where key = 'max_interest_percent'");
  });

  it("sem login não se lê nem se escreve nada", async () => {
    await addItem(db, { name: "Anônimo", stock: 1 });
    for (const t of ["items", "movements", "sales", "customers", "employees", "card_fee_rates", "audit_logs", "app_settings"]) {
      const rows = await db.asAnon((c: pg.Client) => c.query(`select 1 from ${t}`).then((r) => r.rowCount).catch((e) => (e as { code: string }).code));
      expect(rows === 0 || rows === DENIED, `anon leu ${t}: ${rows}`).toBe(true);
    }
    const item = await addItem(db, { name: "Anônimo 2", stock: 1 });
    expect(
      await codeOf(db.asAnon((c) => c.query("select public.create_sale(gen_random_uuid(), null, $1::jsonb)", [JSON.stringify([{ item_id: item, quantity: 1 }])])))
    ).toBe(DENIED);
  });
});

describe("funcionários e papéis", () => {
  it("só admin/ceo muda papel; a mudança fica auditada com quem fez", async () => {
    const byManager = await db.asUser(ids.manager, (c) => c.query("update employees set role = 'admin' where id = $1", [ids.seller2]));
    expect(byManager.rowCount).toBe(0);
    const bySeller = await db.asUser(ids.seller, (c) => c.query("update employees set role = 'ceo' where id = $1", [ids.seller]));
    expect(bySeller.rowCount).toBe(0); // vendedor não se promove
    expect((await db.one<{ role: string }>("select role from employees where id = $1", [ids.seller])).role).toBe("vendedor");

    const byAdmin = await db.asUser(ids.admin, (c) => c.query("update employees set role = 'gerente' where id = $1", [ids.seller2]));
    expect(byAdmin.rowCount).toBe(1);
    const log = await db.one<{ action: string; actor_id: string; changes: { role: { old: string; new: string } } }>(
      "select * from audit_logs where action = 'employee.role_changed' and entity_id = $1",
      [ids.seller2]
    );
    expect(log.actor_id).toBe(ids.admin);
    expect(log.changes.role).toEqual({ old: "vendedor", new: "gerente" });
    await db.q("update employees set role = 'vendedor' where id = $1", [ids.seller2]);
  });

  it("papel inválido é recusado pelo banco", async () => {
    const code = await codeOf(db.su.query("update employees set role = 'dono' where id = $1", [ids.seller]));
    expect(code).toBe("23514");
  });

  it("CEO tem poder de admin (edita papéis e vê tudo)", async () => {
    const r = await db.asUser(ids.ceo, (c) => c.query("update employees set full_name = 'João Vendedor' where id = $1", [ids.seller]));
    expect(r.rowCount).toBe(1);
  });
});

describe("funções internas não são chamáveis por usuários", () => {
  it("enqueue_notification / audit_write / claim / mark_* só service_role", async () => {
    const calls = [
      "select public.enqueue_notification('SALE_COMPLETED','sale','x','forjado','{}'::jsonb)",
      "select public.audit_write('falso','sale','x')",
      "select * from public.notification_claim(5)",
      "select public.notification_mark_sent(gen_random_uuid())",
      "select public.notification_mark_failed(gen_random_uuid(), 'x')",
    ];
    for (const user of [ids.seller, ids.manager, ids.admin]) {
      for (const sql of calls) {
        expect(await codeOf(db.asUser(user, (c) => c.query(sql))), sql).toBe(DENIED);
      }
    }
  });
});

describe("cancelar / devolver: só gerente+", () => {
  it("vendedor não cancela nem devolve", async () => {
    const item = await addItem(db, { name: "Só gerente", price: 10, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }] });
    expect(await hintOf(db.asUser(ids.seller, (c) => c.query("select public.cancel_sale($1, 'desistiu')", [sale.sale_id])))).toBe("FORBIDDEN");
    const si = await db.one<{ id: string }>("select id from sale_items where sale_id = $1", [sale.sale_id]);
    expect(
      await hintOf(
        db.asUser(ids.seller, (c) =>
          c.query("select public.return_sale_items($1, $2::jsonb, 'defeito', gen_random_uuid())", [sale.sale_id, JSON.stringify([{ sale_item_id: si.id, quantity: 1 }])])
        )
      )
    ).toBe("FORBIDDEN");
    expect(await stockOf(db, item)).toBe(3);
  });
});
