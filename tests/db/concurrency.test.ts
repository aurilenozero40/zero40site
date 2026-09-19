import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { addItem, createTestDb, ids, sell, stockOf, type TestDb } from "./helpers";

/**
 * Estes testes usam CONEXÕES DE VERDADE em paralelo contra um Postgres real — é o que prova
 * que duas pessoas vendendo ao mesmo tempo não conseguem furar o estoque.
 */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

const scalar = async (sql: string, params: unknown[] = []) => Number((await db.one<{ n: string }>(sql, params)).n);
const failure = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as { hint?: string }).hint : undefined);

describe("vendas simultâneas", () => {
  it("estoque = 1 e dois vendedores ao mesmo tempo: só UM consegue vender", async () => {
    const item = await addItem(db, { name: "Última peça", price: 100, stock: 1 });
    const results = await Promise.allSettled([
      sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] }),
      sell(db, ids.seller2, { items: [{ item_id: item, quantity: 1 }] }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.map(failure).filter(Boolean)).toEqual(["INSUFFICIENT_STOCK"]);
    expect(await stockOf(db, item)).toBe(0);
    expect(await scalar("select count(*) n from sale_items where item_id = $1", [item])).toBe(1);
    expect(await scalar("select count(*) n from movements where item_id = $1 and subtype = 'venda'", [item])).toBe(1);
    // e só um aviso de "esgotado"
    expect(await scalar("select count(*) n from notification_outbox where event_type = 'OUT_OF_STOCK' and entity_id = $1", [item])).toBe(1);
  });

  it("10 vendedores disputando 3 unidades: exatamente 3 vendas, 7 recusas, estoque zerado e nunca negativo", async () => {
    const item = await addItem(db, { name: "Disputa", price: 10, stock: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => sell(db, i % 2 ? ids.seller : ids.seller2, { items: [{ item_id: item, quantity: 1 }] }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(results.map(failure).filter((h) => h === "INSUFFICIENT_STOCK")).toHaveLength(7);
    expect(await stockOf(db, item)).toBe(0);
    expect(await scalar("select coalesce(sum(quantity),0) n from sale_items where item_id = $1", [item])).toBe(3);
  });

  it("carrinhos com os mesmos itens em ORDEM OPOSTA não dão deadlock", async () => {
    const x = await addItem(db, { name: "Item X", price: 10, stock: 50 });
    const y = await addItem(db, { name: "Item Y", price: 10, stock: 50 });
    const jobs = Array.from({ length: 20 }, (_, i) =>
      sell(db, i % 2 ? ids.seller : ids.seller2, {
        items: i % 2
          ? [{ item_id: x, quantity: 1 }, { item_id: y, quantity: 1 }]
          : [{ item_id: y, quantity: 1 }, { item_id: x, quantity: 1 }],
      })
    );
    const results = await Promise.allSettled(jobs);
    expect(results.filter((r) => r.status === "rejected"), JSON.stringify(results.filter((r) => r.status === "rejected"))).toHaveLength(0);
    expect(await stockOf(db, x)).toBe(30);
    expect(await stockOf(db, y)).toBe(30);
  });

  it("carrinho com vários itens disputando: vence quem chegou primeiro, o outro não deixa rastro parcial", async () => {
    const a = await addItem(db, { name: "Multi A", price: 10, stock: 5 });
    const b = await addItem(db, { name: "Multi B", price: 10, stock: 1 });
    const results = await Promise.allSettled([
      sell(db, ids.seller, { items: [{ item_id: a, quantity: 2 }, { item_id: b, quantity: 1 }] }),
      sell(db, ids.seller2, { items: [{ item_id: b, quantity: 1 }, { item_id: a, quantity: 3 }] }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const winner = results.findIndex((r) => r.status === "fulfilled");
    expect(await stockOf(db, b)).toBe(0);
    expect(await stockOf(db, a)).toBe(winner === 0 ? 3 : 2); // só o vencedor baixou o item A
  });
});

describe("idempotência sob concorrência", () => {
  it("a MESMA venda enviada 5 vezes ao mesmo tempo (duplo clique / retry) vira uma só", async () => {
    const item = await addItem(db, { name: "Duplo clique", price: 10, stock: 10 });
    const key = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => sell(db, ids.seller, { key, items: [{ item_id: item, quantity: 2 }] }))
    );
    expect(new Set(results.map((r) => r.sale_id)).size).toBe(1);
    expect(results.filter((r) => !r.already_processed)).toHaveLength(1);
    expect(await stockOf(db, item)).toBe(8);
    expect(await scalar("select count(*) n from sales where idempotency_key = $1", [key])).toBe(1);
    expect(await scalar("select count(*) n from notification_outbox where entity_id = $1", [results[0].sale_id])).toBe(1);
  });
});

describe("cancelamento e devolução simultâneos", () => {
  it("dois gerentes cancelando a mesma venda: estoque volta UMA vez", async () => {
    const item = await addItem(db, { name: "Cancela 2x", price: 10, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 3 }] });
    expect(await stockOf(db, item)).toBe(2);

    const cancel = (u: string) => db.asUser(u, async (c) => (await c.query("select public.cancel_sale($1, 'cliente desistiu') r", [sale.sale_id])).rows[0].r);
    const [a, b] = await Promise.all([cancel(ids.manager), cancel(ids.admin)]);

    expect([a.already_processed, b.already_processed].sort()).toEqual([false, true]);
    expect(await stockOf(db, item)).toBe(5);
    expect(await scalar("select count(*) n from movements where sale_id = $1 and subtype = 'cancelamento'", [sale.sale_id])).toBe(1);
    expect(await scalar("select count(*) n from notification_outbox where event_type = 'SALE_CANCELLED' and entity_id = $1", [sale.sale_id])).toBe(1);
  });

  it("duas devoluções totais ao mesmo tempo (chaves diferentes): só uma passa", async () => {
    const item = await addItem(db, { name: "Devolve 2x", price: 10, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }] });
    const si = await db.one<{ id: string }>("select id from sale_items where sale_id = $1", [sale.sale_id]);

    const ret = (u: string) =>
      db.asUser(u, (c) =>
        c.query("select public.return_sale_items($1, $2::jsonb, 'defeito', $3) r", [
          sale.sale_id,
          JSON.stringify([{ sale_item_id: si.id, quantity: 2 }]),
          crypto.randomUUID(),
        ])
      );
    const results = await Promise.allSettled([ret(ids.manager), ret(ids.admin)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    // quem chega depois vê a venda já "devolvida" (ou sem saldo a devolver): recusado de qualquer forma
    expect(["INVALID_STATUS", "INVALID_QUANTITY"]).toContain(results.map(failure).find(Boolean));
    expect(await stockOf(db, item)).toBe(5); // 5 − 2 + 2, não +4
  });

  it("vender enquanto cancelam a mesma peça não corrompe o estoque", async () => {
    const item = await addItem(db, { name: "Vende e cancela", price: 10, stock: 2 });
    const first = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }] }); // estoque 0
    const [cancelled, newSale] = await Promise.allSettled([
      db.asUser(ids.manager, (c) => c.query("select public.cancel_sale($1, 'erro de digitação')", [first.sale_id])),
      sell(db, ids.seller2, { items: [{ item_id: item, quantity: 2 }] }),
    ]);
    expect(cancelled.status).toBe("fulfilled");
    const stock = await stockOf(db, item);
    // se a nova venda entrou depois do cancelamento: 2 − 2 = 0; se chegou antes: recusada e estoque volta a 2
    if (newSale.status === "fulfilled") expect(stock).toBe(0);
    else {
      expect(failure(newSale)).toBe("INSUFFICIENT_STOCK");
      expect(stock).toBe(2);
    }
    expect(stock).toBeGreaterThanOrEqual(0);
  });
});

describe("fila de notificações sob concorrência", () => {
  it("dois workers reivindicando ao mesmo tempo recebem lotes DIFERENTES (SKIP LOCKED)", async () => {
    await db.q("delete from notification_outbox where false"); // no-op: só garante a tabela acessível
    await db.su.query("alter table notification_outbox disable trigger all").catch(() => {});
    await db.su.query("update notification_outbox set status = 'sent'"); // esvazia a fila pendente
    for (let i = 0; i < 6; i++) {
      await db.q(
        "insert into notification_outbox (event_type, entity_type, entity_id, dedupe_key, payload) values ('SALE_COMPLETED','sale',$1,$2,'{}')",
        [`w${i}`, `worker-test-${i}`]
      );
    }
    const a = await db.connect();
    const b = await db.connect();
    try {
      await a.query("begin");
      await b.query("begin");
      const ra = await a.query("select id from public.notification_claim(3)");
      const rb = await b.query("select id from public.notification_claim(3)"); // a ainda não commitou
      const ida = ra.rows.map((r) => r.id);
      const idb = rb.rows.map((r) => r.id);
      expect(ida).toHaveLength(3);
      expect(idb).toHaveLength(3);
      expect(ida.filter((x) => idb.includes(x))).toHaveLength(0); // nenhum enviado em dobro
      await a.query("commit");
      await b.query("commit");
    } finally {
      await a.end();
      await b.end();
    }
  });
});
