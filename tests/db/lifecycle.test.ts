import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { addItem, createTestDb, hintOf, ids, sell, stockOf, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

const cancel = (u: string, saleId: string, reason = "cliente desistiu da compra") =>
  db.asUser(u, async (c) => (await c.query("select public.cancel_sale($1, $2) r", [saleId, reason])).rows[0].r);

const giveBack = (u: string, saleId: string, lines: { sale_item_id: string; quantity: number }[], key = crypto.randomUUID(), reason = "produto com defeito") =>
  db.asUser(u, async (c) =>
    (await c.query("select public.return_sale_items($1, $2::jsonb, $3, $4) r", [saleId, JSON.stringify(lines), reason, key])).rows[0].r
  );

const saleItems = (saleId: string) => db.q<{ id: string; item_id: string }>("select id, item_id from sale_items where sale_id = $1 order by item_name", [saleId]);
const events = (type: string, entity?: string) =>
  db.q<{ status: string; payload: Record<string, unknown> }>(
    `select status, payload from notification_outbox where event_type = $1 ${entity ? "and entity_id = $2" : ""} order by created_at`,
    entity ? [type, entity] : [type]
  );

describe("cancelamento de venda", () => {
  it("devolve ao estoque, muda status, registra quem/quando/por quê e enfileira o aviso", async () => {
    const item = await addItem(db, { name: "Cancelável", price: 200, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }] });
    expect(await stockOf(db, item)).toBe(3);

    const r = await cancel(ids.manager, sale.sale_id, "Cliente desistiu da compra");
    expect(r.status).toBe("cancelada");
    expect(r.already_processed).toBe(false);
    expect(await stockOf(db, item)).toBe(5);

    const row = await db.one<Record<string, string>>("select * from sales where id = $1", [sale.sale_id]);
    expect(row.status).toBe("cancelada");
    expect(row.cancelled_by).toBe(ids.manager);
    expect(row.cancel_reason).toBe("Cliente desistiu da compra");
    expect(row.cancelled_at).toBeTruthy();
    expect(Number(row.refunded_amount)).toBe(400);
    expect(Number(row.total)).toBe(400); // a venda original não é reescrita

    const mv = await db.one<Record<string, string>>("select * from movements where sale_id = $1 and subtype = 'cancelamento'", [sale.sale_id]);
    expect(mv.type).toBe("entrada");
    expect(Number(mv.quantity)).toBe(2);
    expect(mv.created_by).toBe(ids.manager);
    expect(mv.reason).toContain("Cancelamento da venda #" + sale.code);

    const audit = await db.one<{ actor_id: string }>("select actor_id from audit_logs where action = 'sale.cancelled' and entity_id = $1", [sale.sale_id]);
    expect(audit.actor_id).toBe(ids.manager);

    const ev = await events("SALE_CANCELLED", sale.sale_id);
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ code: sale.code, seller: "João Vendedor", cancelled_by: "Marina Gerente", reason: "Cliente desistiu da compra", total: 400 });
  });

  it("cancelar de novo não devolve estoque em dobro nem avisa duas vezes", async () => {
    const item = await addItem(db, { name: "Cancela 2", price: 10, stock: 4 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 4 }] });
    await cancel(ids.manager, sale.sale_id);
    const again = await cancel(ids.admin, sale.sale_id);
    expect(again.already_processed).toBe(true);
    expect(await stockOf(db, item)).toBe(4);
    expect(await events("SALE_CANCELLED", sale.sale_id)).toHaveLength(1);
  });

  it("exige motivo, venda existente e status concluída", async () => {
    const item = await addItem(db, { name: "Regras cancelar", price: 10, stock: 10 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 3 }] });
    expect(await hintOf(cancel(ids.manager, sale.sale_id, "  "))).toBe("REASON_REQUIRED");
    expect(await hintOf(cancel(ids.manager, sale.sale_id, "ok"))).toBe("REASON_REQUIRED");
    expect(await hintOf(cancel(ids.manager, crypto.randomUUID()))).toBe("SALE_NOT_FOUND");

    const [line] = await saleItems(sale.sale_id);
    await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 1 }]);
    expect(await hintOf(cancel(ids.manager, sale.sale_id))).toBe("INVALID_STATUS"); // já teve devolução
    expect(await stockOf(db, item)).toBe(8); // 10 − 3 + 1
  });

  it("cancelamento de carrinho com vários produtos devolve todos", async () => {
    const a = await addItem(db, { name: "Cancel A", price: 10, stock: 5 });
    const b = await addItem(db, { name: "Cancel B", price: 20, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: a, quantity: 2 }, { item_id: b, quantity: 3 }] });
    await cancel(ids.ceo, sale.sale_id);
    expect(await stockOf(db, a)).toBe(5);
    expect(await stockOf(db, b)).toBe(5);
  });
});

describe("devolução (parcial e total)", () => {
  it("parcial: devolve ao estoque, reembolso proporcional, status parcialmente_devolvida", async () => {
    const item = await addItem(db, { name: "Parcial", price: 100, stock: 10 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 3 }] }); // total 300
    const [line] = await saleItems(sale.sale_id);

    const r = await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 1 }]);
    expect(r.status).toBe("parcialmente_devolvida");
    expect(r.refund).toBe(100);
    expect(await stockOf(db, item)).toBe(8);

    const row = await db.one<Record<string, string>>("select * from sales where id = $1", [sale.sale_id]);
    expect(row.status).toBe("parcialmente_devolvida");
    expect(Number(row.refunded_amount)).toBe(100);
    const li = await db.one<{ returned_quantity: string }>("select returned_quantity from sale_items where id = $1", [line.id]);
    expect(Number(li.returned_quantity)).toBe(1);

    const mv = await db.one<Record<string, string>>("select * from movements where sale_id = $1 and subtype = 'devolucao'", [sale.sale_id]);
    expect(mv.type).toBe("entrada");
    expect(mv.created_by).toBe(ids.manager);
    expect(mv.reason).toContain("produto com defeito");

    const ev = await events("SALE_RETURNED", sale.sale_id);
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ code: sale.code, refund: 100, returned_by: "Marina Gerente", full: false });
  });

  it("total: fecha em 'devolvida' e o reembolso soma EXATAMENTE o total (sem resto de centavos)", async () => {
    // desconto + juros + preço quebrado → arredondamentos por unidade não fecham sozinhos
    const item = await addItem(db, { name: "Centavos", price: 33.33, stock: 10 });
    const sale = await sell(db, ids.manager, {
      items: [{ item_id: item, quantity: 3 }],
      discount: 0.07,
      method: "credito_parcelado",
      installments: 2,
      interest: 3.333,
      brand: "visa",
    });
    const [line] = await saleItems(sale.sale_id);

    for (let i = 0; i < 3; i++) await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 1 }]);

    const row = await db.one<Record<string, string>>("select status, total, refunded_amount from sales where id = $1", [sale.sale_id]);
    expect(row.status).toBe("devolvida");
    expect(Number(row.refunded_amount)).toBe(Number(row.total));
    expect(await stockOf(db, item)).toBe(10);
  });

  it("devolver o restante depois de uma parcial", async () => {
    const item = await addItem(db, { name: "Em duas vezes", price: 50, stock: 10 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 4 }] });
    const [line] = await saleItems(sale.sale_id);
    await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 1 }]);
    const r = await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 3 }]);
    expect(r.status).toBe("devolvida");
    expect(await stockOf(db, item)).toBe(10);
  });

  it("devolução de vários itens numa venda: só os selecionados voltam; status parcial até devolver tudo", async () => {
    const a = await addItem(db, { name: "Dev A", price: 10, stock: 5 });
    const b = await addItem(db, { name: "Dev B", price: 10, stock: 5 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: a, quantity: 2 }, { item_id: b, quantity: 2 }] });
    const [la, lb] = await saleItems(sale.sale_id);

    const r1 = await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: la.id, quantity: 2 }]);
    expect(r1.status).toBe("parcialmente_devolvida");
    expect(await stockOf(db, a)).toBe(5);
    expect(await stockOf(db, b)).toBe(3);
    const r2 = await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: lb.id, quantity: 2 }]);
    expect(r2.status).toBe("devolvida");
  });

  it("recusa quantidade acima do vendido, item de outra venda, venda cancelada e devolução repetida do total", async () => {
    const item = await addItem(db, { name: "Regras devolver", price: 10, stock: 10 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }] });
    const other = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    const [line] = await saleItems(sale.sale_id);
    const [otherLine] = await saleItems(other.sale_id);

    expect(await hintOf(giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 3 }]))).toBe("INVALID_QUANTITY");
    expect(await hintOf(giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 0 }]))).toBe("INVALID_QUANTITY");
    expect(await hintOf(giveBack(ids.manager, sale.sale_id, [{ sale_item_id: otherLine.id, quantity: 1 }]))).toBe("INVALID_ITEM");
    expect(await hintOf(giveBack(ids.manager, sale.sale_id, []))).toBe("EMPTY_CART");
    expect(await hintOf(giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 1 }], crypto.randomUUID(), " "))).toBe("REASON_REQUIRED");
    expect(await stockOf(db, item)).toBe(7); // nada devolvido nas tentativas inválidas

    await cancel(ids.manager, other.sale_id);
    expect(await hintOf(giveBack(ids.manager, other.sale_id, [{ sale_item_id: otherLine.id, quantity: 1 }]))).toBe("INVALID_STATUS");
  });

  it("mesma chave de devolução repetida não devolve em dobro nem avisa em dobro", async () => {
    const item = await addItem(db, { name: "Devolução idempotente", price: 10, stock: 10 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 4 }] });
    const [line] = await saleItems(sale.sale_id);
    const key = crypto.randomUUID();
    const first = await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 1 }], key);
    const again = await giveBack(ids.manager, sale.sale_id, [{ sale_item_id: line.id, quantity: 1 }], key);
    expect(first.already_processed).toBe(false);
    expect(again.already_processed).toBe(true);
    expect(await stockOf(db, item)).toBe(7); // 10 − 4 + 1
    expect(await events("SALE_RETURNED", sale.sale_id)).toHaveLength(1);
  });
});

describe("alertas de estoque (LOW_STOCK / OUT_OF_STOCK)", () => {
  it("avisa UMA vez na virada para baixo e UMA vez quando zera — sem repetir enquanto continua baixo", async () => {
    const item = await addItem(db, { name: "Alertas", price: 10, stock: 10, min: 3 });
    const sellQty = (q: number) => sell(db, ids.seller, { items: [{ item_id: item, quantity: q }] });
    const count = async (t: string) => (await events(t)).filter((e) => e.payload.item_id === item).length;

    await sellQty(5); // 10 → 5 (acima do mínimo)
    expect(await count("LOW_STOCK")).toBe(0);
    await sellQty(2); // 5 → 3 (= mínimo → estoque baixo)
    expect(await count("LOW_STOCK")).toBe(1);
    await sellQty(1); // 3 → 2 (continua baixo: NÃO repete)
    expect(await count("LOW_STOCK")).toBe(1);
    await sellQty(2); // 2 → 0 (esgotado, não "baixo" de novo)
    expect(await count("LOW_STOCK")).toBe(1);
    expect(await count("OUT_OF_STOCK")).toBe(1);

    const low = (await events("LOW_STOCK")).find((e) => e.payload.item_id === item)!;
    expect(low.payload).toMatchObject({ name: "Alertas", quantity: 3, min_stock: 3 });
  });

  it("reposição + nova queda gera novo alerta (é outra ocorrência)", async () => {
    const item = await addItem(db, { name: "Vai e volta", price: 10, stock: 5, min: 2 });
    const count = async () => (await events("LOW_STOCK")).filter((e) => e.payload.item_id === item).length;
    await sell(db, ids.seller, { items: [{ item_id: item, quantity: 4 }] }); // 5 → 1: baixo
    expect(await count()).toBe(1);
    await db.q("insert into movements (item_id, type, subtype, quantity, created_by) values ($1,'entrada','compra',10,$2)", [item, ids.admin]);
    await sell(db, ids.seller, { items: [{ item_id: item, quantity: 9 }] }); // 11 → 2: baixo de novo
    expect(await count()).toBe(2);
  });

  it("produto sem estoque mínimo só avisa quando ESGOTA; produto recém-cadastrado em 0 não gera nada", async () => {
    const before = (await events("OUT_OF_STOCK")).length;
    await addItem(db, { name: "Recém-cadastrado", stock: 0 });
    expect((await events("OUT_OF_STOCK")).length).toBe(before);

    const item = await addItem(db, { name: "Sem mínimo", price: 10, stock: 3, min: 0 });
    await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }] }); // 3 → 1: sem alerta (mínimo 0)
    expect((await events("LOW_STOCK")).filter((e) => e.payload.item_id === item)).toHaveLength(0);
    await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] }); // 1 → 0
    expect((await events("OUT_OF_STOCK")).filter((e) => e.payload.item_id === item)).toHaveLength(1);
  });

  it("perda/saída manual também dispara o alerta (não só a venda)", async () => {
    const item = await addItem(db, { name: "Perda manual", stock: 3, min: 2 });
    await db.asUser(ids.manager, (c) =>
      c.query("select public.create_movement('saida', $1, 2, 'perda', null, 'quebrou', null, null)", [item])
    );
    expect((await events("LOW_STOCK")).filter((e) => e.payload.item_id === item)).toHaveLength(1);
  });

  it("entrada de estoque só notifica se o evento estiver habilitado", async () => {
    const item = await addItem(db, { name: "Entrada", stock: 0 });
    const enter = () => db.q("insert into movements (item_id, type, subtype, quantity, created_by) values ($1,'entrada','compra',5,$2)", [item, ids.admin]);
    await enter();
    expect((await events("STOCK_ENTRY")).filter((e) => e.payload.item_id === item)).toHaveLength(0); // desligado por padrão

    await db.q(`update app_settings set value = '["SALE_COMPLETED","STOCK_ENTRY"]' where key = 'notify_events'`);
    await enter();
    expect((await events("STOCK_ENTRY")).filter((e) => e.payload.item_id === item)).toHaveLength(1);

    // e evento desabilitado não entra na fila
    const low = await addItem(db, { name: "Baixo desligado", price: 10, stock: 2, min: 5 });
    await sell(db, ids.seller, { items: [{ item_id: low, quantity: 1 }] });
    expect((await events("LOW_STOCK")).filter((e) => e.payload.item_id === low)).toHaveLength(0);
    await db.q(
      `update app_settings set value = '["SALE_COMPLETED","SALE_CANCELLED","SALE_RETURNED","LOW_STOCK","OUT_OF_STOCK"]' where key = 'notify_events'`
    );
  });

  it("stock_alerts(): baixo = mínimo definido e saldo > 0; esgotado só se já teve movimento", async () => {
    const low = await addItem(db, { name: "AL baixo", stock: 2, min: 5 });
    const out = await addItem(db, { name: "AL esgotado", price: 10, stock: 1 });
    await sell(db, ids.seller, { items: [{ item_id: out, quantity: 1 }] });
    const neverStocked = await addItem(db, { name: "AL nunca estocado", stock: 0 });
    const noMin = await addItem(db, { name: "AL sem mínimo", stock: 1, min: 0 });

    const alerts = await db.asUser(ids.manager, async (c) => (await c.query("select public.stock_alerts() r")).rows[0].r as { low: { id: string }[]; out: { id: string }[] });
    const lowIds = alerts.low.map((x) => x.id);
    const outIds = alerts.out.map((x) => x.id);
    expect(lowIds).toContain(low);
    expect(lowIds).not.toContain(noMin);
    expect(outIds).toContain(out);
    expect(outIds).not.toContain(neverStocked); // 46 produtos recém-cadastrados não viram "46 esgotados"
    expect(lowIds).not.toContain(out);
  });
});

describe("resumo de estoque (inventory_summary)", () => {
  it("conta só itens ativos e valoriza pelo custo e pelo preço de venda", async () => {
    const d = await createTestDb("upgrade");
    const base = await d.asUser(ids.manager, async (c) => (await c.query("select public.inventory_summary() r")).rows[0].r);
    await addItem(d, { name: "Resumo A", price: 100, cost: 60, stock: 3 });
    await addItem(d, { name: "Resumo B", price: 10, cost: 4, stock: 5 });
    await addItem(d, { name: "Resumo inativo", price: 999, cost: 999, stock: 9, active: false });
    await addItem(d, { name: "Resumo sem estoque", price: 50, cost: 20, stock: 0 });
    const r = await d.asUser(ids.manager, async (c) => (await c.query("select public.inventory_summary() r")).rows[0].r);
    expect(r.active_items - base.active_items).toBe(3);
    expect(Number(r.units) - Number(base.units)).toBe(8);
    expect(Number(r.cost_value) - Number(base.cost_value)).toBe(3 * 60 + 5 * 4);
    expect(Number(r.sale_value) - Number(base.sale_value)).toBe(3 * 100 + 5 * 10);
    await d.close();
  });
});

describe("limites de venda (sale_limits)", () => {
  const limits = (u: string) => db.asUser(u, async (c) => (await c.query("select public.sale_limits() r")).rows[0].r as { discount_limit_percent: number; max_interest_percent: number });

  it("vendedor enxerga o próprio limite sem ler as configurações; gerente enxerga o dele", async () => {
    expect(await limits(ids.seller)).toEqual({ discount_limit_percent: 0, max_interest_percent: 50 });
    expect(await limits(ids.manager)).toEqual({ discount_limit_percent: 100, max_interest_percent: 50 });
    await db.q("update app_settings set value = '7.5' where key = 'discount_limit_percent_vendedor'");
    expect((await limits(ids.seller)).discount_limit_percent).toBe(7.5);
    await db.q("update app_settings set value = '0' where key = 'discount_limit_percent_vendedor'");
  });

  it("sem sessão, cai no limite mais restritivo", async () => {
    const r = await db.asAnon(async (c) => (await c.query("select public.sale_limits() r")).rows[0].r as { discount_limit_percent: number }).catch(() => ({ discount_limit_percent: -1 }));
    expect([0, -1]).toContain(r.discount_limit_percent); // anon nem tem permissão de execução, ou recebe 0
  });
});

describe("dashboard (sales_dashboard / sales_revenue)", () => {
  const range = ["2000-01-01T00:00:00Z", "2100-01-01T00:00:00Z"];
  const dash = (u: string) => db.asUser(u, async (c) => (await c.query("select public.sales_dashboard($1,$2) r", range)).rows[0].r);

  it("faturamento = vendas − canceladas − devolvido; contagem, ticket, formas de pagamento, vendedores", async () => {
    // banco de dashboard isolado: zera as vendas de testes anteriores neste arquivo
    const d0 = await createTestDb("upgrade");
    const it1 = await addItem(d0, { name: "Dash 1", price: 100, stock: 50 });
    const s = (u: string, a: Parameters<typeof sell>[2]) => sell(d0, u, a);

    await s(ids.seller, { items: [{ item_id: it1, quantity: 1 }] }); // pix 100
    await s(ids.seller2, { items: [{ item_id: it1, quantity: 3 }], method: "credito_parcelado", installments: 2, interest: 10, brand: "visa", discount: 0 }).catch(() => {}); // vendedor sem desconto ok, juros ok
    const cardSale = await s(ids.manager, { items: [{ item_id: it1, quantity: 2 }], method: "credito_parcelado", installments: 2, interest: 10, brand: "visa" }); // 200 + 20 juros = 220
    const toCancel = await s(ids.seller, { items: [{ item_id: it1, quantity: 5 }] }); // 500 (será cancelada)
    const toReturn = await s(ids.seller2, { items: [{ item_id: it1, quantity: 4 }] }); // 400, devolve 1 → 300

    await d0.asUser(ids.manager, (c) => c.query("select public.cancel_sale($1, 'engano')", [toCancel.sale_id]));
    const [li] = await d0.q<{ id: string }>("select id from sale_items where sale_id = $1", [toReturn.sale_id]);
    await d0.asUser(ids.manager, (c) =>
      c.query("select public.return_sale_items($1, $2::jsonb, 'defeito', gen_random_uuid())", [toReturn.sale_id, JSON.stringify([{ sale_item_id: li.id, quantity: 1 }])])
    );

    const r = await d0.asUser(ids.manager, async (c) => (await c.query("select public.sales_dashboard($1,$2) r", range)).rows[0].r);
    // vendas ativas: pix 100 · cartão(seller2) 3×100+10% = 330 · cartão(manager) 220 · devolução parcial 400−100 = 300 (cancelada 500 fora)
    expect(Number(r.revenue)).toBe(100 + 330 + 220 + 300);
    expect(r.sales_count).toBe(4);
    expect(Number(r.ticket_avg)).toBe(Math.round(((100 + 330 + 220 + 300) / 4) * 100) / 100);
    expect(Number(r.interest)).toBe(30 + 20);
    expect(r.units_sold).toBe(1 + 3 + 2 + 3);
    expect(r.by_payment.map((p: { method: string }) => p.method).sort()).toEqual(["credito_parcelado", "pix"]);
    expect(r.by_seller[0].revenue >= r.by_seller[r.by_seller.length - 1].revenue).toBe(true); // ranking decrescente
    expect(new Set(r.by_seller.map((x: { seller: string }) => x.seller))).toEqual(new Set(["João Vendedor", "Pedro Vendedor", "Marina Gerente"]));
    expect(cardSale.total).toBe(220);

    // vendedor enxerga só o que é dele
    const mine = await d0.asUser(ids.seller, async (c) => (await c.query("select public.sales_dashboard($1,$2) r", range)).rows[0].r);
    expect(Number(mine.revenue)).toBe(100); // a de 500 foi cancelada
    expect(mine.by_seller).toHaveLength(1);

    const rev = await d0.asUser(ids.manager, async (c) => (await c.query("select public.sales_revenue($1,$2) r", range)).rows[0].r);
    expect(Number(rev)).toBe(Number(r.revenue));
    await d0.close();
  });

  it("agrupa por dia no fuso de São Paulo (venda às 22h30 do dia 18 não cai no dia 19)", async () => {
    const d1 = await createTestDb("upgrade");
    // 2026-09-19 01:30 UTC = 2026-09-18 22:30 em Brasília
    await d1.q(
      `insert into sales (idempotency_key, seller_id, subtotal, total, created_at)
       values (gen_random_uuid(), $1, 100, 100, '2026-09-19T01:30:00Z'), (gen_random_uuid(), $1, 50, 50, '2026-09-19T15:00:00Z')`,
      [ids.seller]
    );
    const r = await d1.asUser(ids.ceo, async (c) => (await c.query("select public.sales_dashboard('2026-09-01Z','2026-10-01Z') r")).rows[0].r);
    expect(r.daily).toEqual([
      { day: "2026-09-18", revenue: 100, sales: 1 },
      { day: "2026-09-19", revenue: 50, sales: 1 },
    ]);
    await d1.close();
    void dash;
  });
});

describe("fila de notificações: envio, falha e retry", () => {
  const seed = async (key: string) => {
    const r = await db.one<{ id: string }>(
      "insert into notification_outbox (event_type, entity_type, entity_id, dedupe_key, payload) values ('SALE_COMPLETED','sale',$1,$1,'{}') returning id",
      [key]
    );
    return r.id;
  };
  const row = (id: string) => db.one<Record<string, string | number | null>>("select * from notification_outbox where id = $1", [id]);
  const drain = () => db.q("update notification_outbox set status = 'sent' where status in ('pending','sending')");

  it("claim marca 'sending' e conta a tentativa; item já reivindicado não sai de novo", async () => {
    await drain();
    const id = await seed("q-claim");
    const first = await db.q<{ id: string }>("select id from notification_claim(10)");
    expect(first.map((r) => r.id)).toEqual([id]);
    expect((await row(id)).status).toBe("sending");
    expect(Number((await row(id)).attempts)).toBe(1);
    expect(await db.q("select id from notification_claim(10)")).toHaveLength(0);
  });

  it("falha com retry: volta para 'pending' com backoff, guarda o erro e só reaparece quando vence", async () => {
    await drain();
    const id = await seed("q-retry");
    await db.q("select * from notification_claim(10)");
    await db.q("select notification_mark_failed($1, 'Telegram fora do ar', true)", [id]);
    const r = await row(id);
    expect(r.status).toBe("pending");
    expect(r.last_error).toBe("Telegram fora do ar");
    expect(await db.q("select id from notification_claim(10)")).toHaveLength(0); // ainda em backoff

    await db.q("update notification_outbox set next_attempt_at = now() - interval '1 second' where id = $1", [id]);
    const again = await db.q<{ id: string }>("select id from notification_claim(10)");
    expect(again.map((x) => x.id)).toEqual([id]);
    expect(Number((await row(id)).attempts)).toBe(2);
  });

  it("backoff cresce a cada tentativa e vira 'failed' ao esgotar; erro permanente falha na hora", async () => {
    await drain();
    const id = await seed("q-exhaust");
    await db.q("update notification_outbox set max_attempts = 3 where id = $1", [id]);
    const delays: number[] = [];
    for (let i = 0; i < 3; i++) {
      await db.q("update notification_outbox set next_attempt_at = now() where id = $1", [id]);
      await db.q("select * from notification_claim(10)");
      await db.q("select notification_mark_failed($1, 'boom', true)", [id]);
      const r = await db.one<{ status: string; secs: string }>(
        "select status, extract(epoch from (next_attempt_at - now())) secs from notification_outbox where id = $1",
        [id]
      );
      delays.push(Math.round(Number(r.secs)));
      if (i < 2) expect(r.status).toBe("pending");
      else expect(r.status).toBe("failed");
    }
    expect(delays[1]).toBeGreaterThan(delays[0]); // 60s > 30s (exponencial)

    const perm = await seed("q-perm");
    await db.q("select * from notification_claim(10)");
    await db.q("select notification_mark_failed($1, 'chat não encontrado', false)", [perm]);
    expect((await row(perm)).status).toBe("failed");
  });

  it("envio bem-sucedido marca 'sent' e nunca mais é reivindicado", async () => {
    await drain();
    const id = await seed("q-sent");
    await db.q("select * from notification_claim(10)");
    await db.q("select notification_mark_sent($1)", [id]);
    const r = await row(id);
    expect(r.status).toBe("sent");
    expect(r.sent_at).toBeTruthy();
    expect(r.last_error).toBeNull();
    await db.q("update notification_outbox set next_attempt_at = now() where id = $1", [id]);
    expect(await db.q("select id from notification_claim(10)")).toHaveLength(0);
  });

  it("worker que travou (sending há mais de 5 min) tem o item reassumido", async () => {
    await drain();
    const id = await seed("q-stale");
    await db.q("select * from notification_claim(10)");
    await db.q("update notification_outbox set locked_at = now() - interval '6 minutes' where id = $1", [id]);
    const again = await db.q<{ id: string }>("select id from notification_claim(10)");
    expect(again.map((x) => x.id)).toEqual([id]);
  });

  it("retry manual: só admin/ceo reenvia o que falhou", async () => {
    await drain();
    const id = await seed("q-manual");
    await db.q("update notification_outbox set status = 'failed', attempts = 8, last_error = 'x' where id = $1", [id]);
    expect(await hintOf(db.asUser(ids.manager, (c) => c.query("select notification_retry($1)", [id])))).toBe("FORBIDDEN");
    expect(await hintOf(db.asUser(ids.seller, (c) => c.query("select notification_retry($1)", [id])))).toBe("FORBIDDEN");
    await db.asUser(ids.admin, (c) => c.query("select notification_retry($1)", [id]));
    const r = await row(id);
    expect(r.status).toBe("pending");
    expect(Number(r.attempts)).toBe(0);
    expect(r.last_error).toBeNull();
  });

  it("o mesmo evento nunca entra duas vezes na fila (dedupe)", async () => {
    await db.q("select enqueue_notification('SALE_COMPLETED','sale','dup','SALE_COMPLETED:dup','{}'::jsonb)");
    await db.q("select enqueue_notification('SALE_COMPLETED','sale','dup','SALE_COMPLETED:dup','{\"x\":1}'::jsonb)");
    expect((await events("SALE_COMPLETED", "dup"))).toHaveLength(1);
  });

  it("a venda continua válida mesmo com o Telegram indisponível (a fila só fica pendente)", async () => {
    const item = await addItem(db, { name: "Telegram fora", price: 10, stock: 2 });
    const sale = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    const ev = await events("SALE_COMPLETED", sale.sale_id);
    expect(ev[0].status).toBe("pending");
    const s = await db.one<{ status: string }>("select status from sales where id = $1", [sale.sale_id]);
    expect(s.status).toBe("concluida");
    expect(await stockOf(db, item)).toBe(1);
  });
});

describe("conteúdo do evento de venda (o que o Telegram vai mostrar)", () => {
  it("guarda uma foto completa: itens com estoque antes→depois, valores separados e pagamento", async () => {
    const cust = await db.asUser(ids.seller, (c) => c.query("insert into customers (name) values ('Carlos Oliveira') returning id"));
    const item = await addItem(db, { name: "iPhone 15 128GB", price: 4499, stock: 7 });
    const sale = await sell(db, ids.manager, {
      customer: cust.rows[0].id,
      items: [{ item_id: item, quantity: 1 }],
      discount: 100,
      method: "credito_parcelado",
      installments: 10,
      interest: 6.8,
      brand: "master",
    });
    const [ev] = await events("SALE_COMPLETED", sale.sale_id);
    const p = ev.payload as Record<string, unknown> & { items: Record<string, unknown>[]; stock: Record<string, unknown>[]; payment: Record<string, unknown> };
    expect(p).toMatchObject({ code: sale.code, seller: "Marina Gerente", customer: "Carlos Oliveira", subtotal: 4499, discount: 100, interest: 299.13, total: 4698.13 });
    expect(p.items[0]).toMatchObject({ name: "iPhone 15 128GB", quantity: 1, unit_price: 4499 });
    expect(p.stock[0]).toMatchObject({ name: "iPhone 15 128GB", before: 7, after: 6 });
    expect(p.payment).toMatchObject({ method: "credito_parcelado", installments: 10, installment_value: 469.81, interest_percent: 6.8, card_brand: "master", fee_percent: 8.89 });
  });
});
