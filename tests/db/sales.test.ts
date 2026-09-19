import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { addItem, callCreateSale, createTestDb, hintOf, ids, sell, stockOf, type TestDb } from "./helpers";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

const count = async (table: string) => Number((await db.one<{ n: string }>(`select count(*) n from ${table}`)).n);

describe("create_sale — venda simples (PIX)", () => {
  it("baixa o estoque, grava tudo e o preço vem do banco", async () => {
    const item = await addItem(db, { name: "Garmin 55 Preto", price: 1500, cost: 900, stock: 5, barcode: "753759279608" });
    const r = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2 }], notes: "cliente pediu embalagem" });

    expect(r.total).toBe(3000);
    expect(r.status).toBe("concluida");
    expect(r.already_processed).toBe(false);
    expect(await stockOf(db, item)).toBe(3);

    const sale = await db.one<Record<string, string>>("select * from sales where id = $1", [r.sale_id]);
    expect(sale.seller_id).toBe(ids.seller); // vendedor vem da sessão, não do navegador
    expect(Number(sale.subtotal)).toBe(3000);
    expect(Number(sale.discount_amount)).toBe(0);
    expect(Number(sale.interest_amount)).toBe(0);
    expect(sale.notes).toBe("cliente pediu embalagem");

    const line = await db.one<Record<string, string>>("select * from sale_items where sale_id = $1", [r.sale_id]);
    expect(line.item_name).toBe("Garmin 55 Preto");
    expect(line.item_barcode).toBe("753759279608");
    expect(Number(line.unit_price)).toBe(1500);
    expect(Number(line.unit_cost)).toBe(900); // custo congelado para margem futura

    const pay = await db.one<Record<string, string | null>>("select * from sale_payments where sale_id = $1", [r.sale_id]);
    expect(pay.method).toBe("pix");
    expect(Number(pay.amount)).toBe(3000);
    expect(pay.fee_percent).toBeNull(); // PIX não tem taxa de operadora
    expect(pay.card_brand).toBeNull();

    const mv = await db.one<Record<string, string>>("select * from movements where sale_id = $1", [r.sale_id]);
    expect(mv.type).toBe("saida");
    expect(mv.subtype).toBe("venda");
    expect(Number(mv.quantity)).toBe(2);
    expect(mv.created_by).toBe(ids.seller);
    expect(mv.reason).toBe(`Venda #${r.code}`);

    const audit = await db.one<Record<string, string>>(
      "select * from audit_logs where action = 'sale.created' and entity_id = $1",
      [r.sale_id]
    );
    expect(audit.actor_id).toBe(ids.seller);
    expect(audit.actor_name).toBe("João Vendedor");
  });

  it("numera as vendas em sequência (VND-000001…)", async () => {
    const item = await addItem(db, { name: "Item seq", stock: 10 });
    const a = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    const b = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    expect(b.number).toBe(a.number + 1);
    expect(b.code).toBe("VND-" + String(b.number).padStart(6, "0"));
  });

  it("soma linhas repetidas do mesmo produto numa só", async () => {
    const item = await addItem(db, { name: "Repetido", price: 10, stock: 10 });
    const r = await sell(db, ids.seller, {
      items: [
        { item_id: item, quantity: 1 },
        { item_id: item, quantity: 2 },
      ],
    });
    const lines = await db.q("select quantity from sale_items where sale_id = $1", [r.sale_id]);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].quantity)).toBe(3);
    expect(await stockOf(db, item)).toBe(7);
  });

  it("aceita quantidade fracionada (3 casas)", async () => {
    const item = await addItem(db, { name: "Cabo (m)", price: 10, stock: 10 });
    const r = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 2.5 }] });
    expect(r.total).toBe(25);
    expect(await stockOf(db, item)).toBe(7.5);
  });

  it("vincula cliente existente e recusa cliente inexistente/inativo", async () => {
    const item = await addItem(db, { name: "Com cliente", price: 50, stock: 5 });
    const cust = await db.asUser(ids.seller, (c) =>
      c.query("insert into customers (name, document, phone) values ('Carlos Oliveira', '12345678901', '85999990000') returning id")
    );
    const customerId = cust.rows[0].id as string;
    const ok = await sell(db, ids.seller, { customer: customerId, items: [{ item_id: item, quantity: 1 }] });
    const row = await db.one<{ customer_id: string }>("select customer_id from sales where id = $1", [ok.sale_id]);
    expect(row.customer_id).toBe(customerId);

    expect(
      await hintOf(sell(db, ids.seller, { customer: crypto.randomUUID(), items: [{ item_id: item, quantity: 1 }] }))
    ).toBe("CUSTOMER_NOT_FOUND");

    await db.q("update customers set active = false where id = $1", [customerId]);
    expect(await hintOf(sell(db, ids.seller, { customer: customerId, items: [{ item_id: item, quantity: 1 }] }))).toBe(
      "CUSTOMER_NOT_FOUND"
    );
  });
});

describe("create_sale — desconto, juros e taxa de cartão", () => {
  it("crédito parcelado com juros: separa subtotal, desconto, juros e total (exemplo do CEO)", async () => {
    const item = await addItem(db, { name: "iPhone 15 128GB", price: 4499, stock: 7 });
    // subtotal 4.499 − desconto 100 = 4.399 · juros 6,8% = 299,13 · total 4.698,13 · 10x
    const r = await sell(db, ids.manager, {
      items: [{ item_id: item, quantity: 1 }],
      discount: 100,
      method: "credito_parcelado",
      installments: 10,
      interest: 6.8,
      brand: "master",
    });
    expect(r.total).toBe(4698.13);

    const sale = await db.one<Record<string, string>>("select * from sales where id = $1", [r.sale_id]);
    expect(Number(sale.subtotal)).toBe(4499);
    expect(Number(sale.discount_amount)).toBe(100);
    expect(Number(sale.interest_amount)).toBe(299.13);
    expect(Number(sale.total)).toBe(4698.13);

    const pay = await db.one<Record<string, string>>("select * from sale_payments where sale_id = $1", [r.sale_id]);
    expect(pay.method).toBe("credito_parcelado");
    expect(pay.installments).toBe(10);
    expect(Number(pay.installment_value)).toBe(469.81);
    expect(Number(pay.interest_percent)).toBe(6.8);
    expect(pay.card_brand).toBe("master");
    // taxa da OPERADORA (custo da loja): 8,89% sobre o que o cliente pagou
    expect(Number(pay.fee_percent)).toBe(8.89);
    expect(Number(pay.fee_amount)).toBe(417.66); // 4.698,13 × 8,89%
    expect(Number(pay.net_amount)).toBe(4280.47); // o que a loja recebe: 4.698,13 − 417,66
    expect(await stockOf(db, item)).toBe(6);
  });

  it("débito e crédito à vista usam a taxa certa da tabela; taxa 0% é válida", async () => {
    const item = await addItem(db, { name: "Item cartão", price: 1000, stock: 10 });
    const deb = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }], method: "debito", brand: "visa" });
    const cre = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }], method: "credito_vista", brand: "visa" });
    const hip = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }], method: "credito_vista", brand: "hiper" });

    const fee = async (id: string) =>
      db.one<{ fee_percent: string; fee_amount: string; net_amount: string }>(
        "select fee_percent, fee_amount, net_amount from sale_payments where sale_id = $1",
        [id]
      );
    expect(Number((await fee(deb.sale_id)).fee_amount)).toBe(10); // 1,00% de 1000
    expect(Number((await fee(cre.sale_id)).fee_amount)).toBe(33); // 3,30% de 1000
    const h = await fee(hip.sale_id);
    expect(Number(h.fee_percent)).toBe(0); // Hiper 1x = 0,00%: é taxa cadastrada, não "sem taxa"
    expect(Number(h.net_amount)).toBe(1000);
  });

  it("aceita apelidos de bandeira (mastercard→master, hipercard→hiper)", async () => {
    const item = await addItem(db, { name: "Item bandeira", price: 100, stock: 5 });
    const r = await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }], method: "debito", brand: "MasterCard" });
    const p = await db.one<{ card_brand: string }>("select card_brand from sale_payments where sale_id = $1", [r.sale_id]);
    expect(p.card_brand).toBe("master");
  });

  it("desconto: vendedor não pode por padrão; gerente pode; respeita o limite configurado", async () => {
    const item = await addItem(db, { name: "Item desconto", price: 100, stock: 20 });
    const args = (discount: number) => ({ items: [{ item_id: item, quantity: 1 }], discount });

    expect(await hintOf(sell(db, ids.seller, args(1)))).toBe("DISCOUNT_NOT_ALLOWED");
    expect((await sell(db, ids.manager, args(30))).total).toBe(70);

    await db.q("update app_settings set value = '10' where key = 'discount_limit_percent_vendedor'");
    expect((await sell(db, ids.seller, args(10))).total).toBe(90); // exatamente 10%
    expect(await hintOf(sell(db, ids.seller, args(10.5)))).toBe("DISCOUNT_NOT_ALLOWED");
    await db.q("update app_settings set value = '0' where key = 'discount_limit_percent_vendedor'");
  });

  it("recusa desconto negativo, maior que o subtotal e venda de total zero", async () => {
    const item = await addItem(db, { name: "Item desc inválido", price: 100, stock: 20 });
    const one = [{ item_id: item, quantity: 1 }];
    expect(await hintOf(sell(db, ids.manager, { items: one, discount: -5 }))).toBe("INVALID_DISCOUNT");
    expect(await hintOf(sell(db, ids.manager, { items: one, discount: 100.01 }))).toBe("INVALID_DISCOUNT");
    expect(await hintOf(sell(db, ids.manager, { items: one, discount: 100 }))).toBe("INVALID_TOTAL");
  });

  it("valida pagamento: parcelas, juros e bandeira", async () => {
    const item = await addItem(db, { name: "Item pgto", price: 100, stock: 50 });
    const one = [{ item_id: item, quantity: 1 }];
    const h = (a: object) => hintOf(sell(db, ids.seller, { items: one, ...a }));

    expect(await h({ method: "bitcoin" })).toBe("INVALID_PAYMENT");
    expect(await h({ method: "pix", installments: 3 })).toBe("INVALID_INSTALLMENTS");
    expect(await h({ method: "credito_parcelado", installments: 1, brand: "visa" })).toBe("INVALID_INSTALLMENTS");
    expect(await h({ method: "credito_parcelado", installments: 19, brand: "visa" })).toBe("INVALID_INSTALLMENTS");
    expect(await h({ method: "pix", interest: 5 })).toBe("INVALID_INTEREST");
    expect(await h({ method: "credito_vista", brand: "visa", interest: 5 })).toBe("INVALID_INTEREST");
    expect(await h({ method: "credito_parcelado", installments: 2, brand: "visa", interest: -1 })).toBe("INVALID_INTEREST");
    expect(await h({ method: "credito_parcelado", installments: 2, brand: "visa", interest: 51 })).toBe("INVALID_INTEREST");
    expect(await h({ method: "debito" })).toBe("CARD_BRAND_REQUIRED");
    expect(await h({ method: "debito", brand: "amex" })).toBe("FEE_NOT_FOUND"); // sem débito p/ Amex na tabela
    expect(await h({ method: "credito_parcelado", installments: 5, brand: "visa" })).toBe("FEE_NOT_FOUND"); // 5x sem taxa no teste
  });

  it("nenhuma venda recusada deixa rastro (nada de estoque, venda ou evento)", async () => {
    const item = await addItem(db, { name: "Item sem rastro", price: 100, stock: 3 });
    const salesBefore = await count("sales");
    const outboxBefore = await count("notification_outbox");
    await hintOf(sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }], method: "credito_vista", brand: "amex", installments: 1, discount: 999 }));
    expect(await stockOf(db, item)).toBe(3);
    expect(await count("sales")).toBe(salesBefore);
    expect(await count("notification_outbox")).toBe(outboxBefore);
  });
});

describe("create_sale — estoque e carrinho", () => {
  it("recusa estoque insuficiente com mensagem clara e não altera nada", async () => {
    const item = await addItem(db, { name: "Poucas unidades", price: 10, stock: 2 });
    let message = "";
    try {
      await sell(db, ids.seller, { items: [{ item_id: item, quantity: 3 }] });
    } catch (e) {
      message = (e as Error).message;
      expect((e as { hint?: string }).hint).toBe("INSUFFICIENT_STOCK");
    }
    expect(message).toContain("Estoque insuficiente para Poucas unidades");
    expect(message).toContain("disponível 2");
    expect(message).toContain("solicitado 3");
    expect(await stockOf(db, item)).toBe(2);
  });

  it("carrinho com vários itens é atômico: se o segundo falha, o primeiro não baixa", async () => {
    const a = await addItem(db, { name: "Item A", price: 10, stock: 5 });
    const b = await addItem(db, { name: "Item B", price: 10, stock: 1 });
    const hint = await hintOf(
      sell(db, ids.seller, {
        items: [
          { item_id: a, quantity: 2 },
          { item_id: b, quantity: 2 },
        ],
      })
    );
    expect(hint).toBe("INSUFFICIENT_STOCK");
    expect(await stockOf(db, a)).toBe(5);
    expect(await stockOf(db, b)).toBe(1);
    expect(Number((await db.one<{ n: string }>("select count(*) n from movements where item_id = $1 and type = 'saida'", [a])).n)).toBe(0);
  });

  it("recusa produto inexistente, inativo, sem preço e carrinho inválido", async () => {
    const inactive = await addItem(db, { name: "Inativo", price: 10, stock: 5, active: false });
    const noPrice = await addItem(db, { name: "Sem preço", price: null, stock: 5 });
    const zeroPrice = await addItem(db, { name: "Preço zero", price: 0, stock: 5 });
    const ok = await addItem(db, { name: "Ok", price: 10, stock: 5 });
    const h = (items: unknown[]) => hintOf(sell(db, ids.seller, { items: items as never }));

    expect(await h([{ item_id: crypto.randomUUID(), quantity: 1 }])).toBe("PRODUCT_NOT_FOUND");
    expect(await h([{ item_id: inactive, quantity: 1 }])).toBe("PRODUCT_INACTIVE");
    expect(await h([{ item_id: noPrice, quantity: 1 }])).toBe("NO_PRICE");
    expect(await h([{ item_id: zeroPrice, quantity: 1 }])).toBe("NO_PRICE");
    expect(await h([])).toBe("EMPTY_CART");
    expect(await h([{ item_id: "não-é-uuid", quantity: 1 }])).toBe("INVALID_ITEM");
    expect(await h([{ item_id: ok, quantity: 0 }])).toBe("INVALID_QUANTITY");
    expect(await h([{ item_id: ok, quantity: -1 }])).toBe("INVALID_QUANTITY");
    expect(await h([{ item_id: ok, quantity: "abc" }])).toBe("INVALID_QUANTITY");
    expect(await h([{ item_id: ok, quantity: 1.2345 }])).toBe("INVALID_QUANTITY");
    expect(await h(Array.from({ length: 101 }, () => ({ item_id: ok, quantity: 1 })))).toBe("TOO_MANY_ITEMS");
  });

  it("a última unidade zera o estoque e o item some do carrinho de quem tentar depois", async () => {
    const item = await addItem(db, { name: "Última unidade", price: 10, stock: 1 });
    await sell(db, ids.seller, { items: [{ item_id: item, quantity: 1 }] });
    expect(await stockOf(db, item)).toBe(0);
    expect(await hintOf(sell(db, ids.seller2, { items: [{ item_id: item, quantity: 1 }] }))).toBe("INSUFFICIENT_STOCK");
  });
});

describe("create_sale — idempotência", () => {
  it("repetir a mesma chave devolve a mesma venda sem baixar estoque nem avisar de novo", async () => {
    const item = await addItem(db, { name: "Idempotente", price: 10, stock: 5 });
    const key = crypto.randomUUID();
    const first = await sell(db, ids.seller, { key, items: [{ item_id: item, quantity: 2 }] });
    const again = await sell(db, ids.seller, { key, items: [{ item_id: item, quantity: 2 }] });
    const third = await sell(db, ids.seller, { key, items: [{ item_id: item, quantity: 2 }] });

    expect(first.already_processed).toBe(false);
    expect(again.already_processed).toBe(true);
    expect(third.sale_id).toBe(first.sale_id);
    expect(await stockOf(db, item)).toBe(3); // baixou UMA vez
    expect(Number((await db.one<{ n: string }>("select count(*) n from movements where sale_id = $1", [first.sale_id])).n)).toBe(1);
    expect(
      Number((await db.one<{ n: string }>("select count(*) n from notification_outbox where entity_id = $1 and event_type = 'SALE_COMPLETED'", [first.sale_id])).n)
    ).toBe(1);
  });

  it("chave de outro vendedor é recusada", async () => {
    const item = await addItem(db, { name: "Chave alheia", price: 10, stock: 5 });
    const key = crypto.randomUUID();
    await sell(db, ids.seller, { key, items: [{ item_id: item, quantity: 1 }] });
    expect(await hintOf(sell(db, ids.seller2, { key, items: [{ item_id: item, quantity: 1 }] }))).toBe("IDEMPOTENCY_CONFLICT");
  });
});

describe("create_sale — quem pode vender", () => {
  it("recusa sem sessão e usuário inativo", async () => {
    const item = await addItem(db, { name: "Só logado", price: 10, stock: 5 });
    const noSession = await hintOf(
      (async () => {
        const c = await db.connect();
        try {
          await c.query("begin");
          await c.query("set local role authenticated");
          await callCreateSale(c, { items: [{ item_id: item, quantity: 1 }] });
        } finally {
          await c.end();
        }
      })()
    );
    expect(noSession).toBe("NOT_AUTHENTICATED");

    await db.q("update employees set active = false where id = $1", [ids.seller2]);
    expect(await hintOf(sell(db, ids.seller2, { items: [{ item_id: item, quantity: 1 }] }))).toBe("FORBIDDEN");
    await db.q("update employees set active = true where id = $1", [ids.seller2]);
  });
});
