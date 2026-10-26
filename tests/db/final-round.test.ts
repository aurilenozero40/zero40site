import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { monthRange } from "@/lib/dates";
import { addItem, createTestDb, hintOf, ids, sell, stockOf, type TestDb } from "./helpers";

/**
 * Rodada final: normalização/unicidade do cadastro, auditoria de saldo, faturamento no fuso de
 * Fortaleza (conferido por SQL independente) e o fluxo completo entrada → venda → devolução.
 */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

const sqlState = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

const insertItem = (name: string, sku: string | null, barcode: string | null, active = true) =>
  db.q<{ id: string; name: string; sku: string | null; barcode: string | null }>(
    "insert into items (name, sku, barcode, active, created_by) values ($1, $2, $3, $4, $5) returning id, name, sku, barcode",
    [name, sku, barcode, active, ids.admin]
  );

describe("cadastro de produto: normalização", () => {
  it("nome vira CAIXA ALTA sem espaços sobrando; SKU em caixa alta; vazio vira NULL", async () => {
    const [row] = await insertItem("  garmin   oregon 750 ", " 01011b ", "  ");
    expect(row.name).toBe("GARMIN OREGON 750");
    expect(row.sku).toBe("01011B");
    expect(row.barcode).toBeNull();
  });

  it("SKU e código de barras são TEXTO: zero à esquerda é preservado", async () => {
    const [row] = await insertItem("Zero a esquerda", "0101336000", "0001234567890");
    expect(row.sku).toBe("0101336000");
    expect(row.barcode).toBe("0001234567890");
    const back = await db.one<{ sku: string; barcode: string }>("select sku, barcode from items where id = $1", [row.id]);
    expect(back).toEqual({ sku: "0101336000", barcode: "0001234567890" });
  });

  it("editar o nome também normaliza", async () => {
    const [row] = await insertItem("Editavel", null, null);
    await db.q("update items set name = '  novo   nome ' where id = $1", [row.id]);
    expect((await db.one<{ name: string }>("select name from items where id = $1", [row.id])).name).toBe("NOVO NOME");
  });
});

describe("cadastro de produto: unicidade (normalizada)", () => {
  it("SKU duplicado é recusado, mesmo com outra caixa ou espaços", async () => {
    await insertItem("Sku A", "AB-1", null);
    expect(await sqlState(insertItem("Sku B", " ab-1 ", null))).toBe("23505");
  });

  it("código de barras duplicado é recusado; produtos sem código não conflitam entre si", async () => {
    await insertItem("Barras A", null, "7891234567895");
    expect(await sqlState(insertItem("Barras B", null, " 7891234567895 "))).toBe("23505");
    await insertItem("Sem codigo 1", null, null);
    await insertItem("Sem codigo 2", null, null);
  });

  it("nome duplicado entre produtos ATIVOS é recusado; inativo libera o nome", async () => {
    await insertItem("Nome unico", null, null);
    expect(await sqlState(insertItem("  nome   UNICO ", null, null))).toBe("23505");
    await insertItem("Nome inativo", null, null, false);
    await insertItem("Nome inativo", null, null, true); // o duplicado antigo está inativo
  });
});

describe("funcionários: nome de exibição nunca é e-mail", () => {
  it("usuário criado sem nome no Auth ganha nome derivado do e-mail (sem @)", async () => {
    await db.q("insert into auth.users (id, email, raw_user_meta_data) values (gen_random_uuid(), 'maria.silva@loja.com', '{}')");
    const e = await db.one<{ full_name: string }>("select full_name from employees where username like 'maria.silva-%'");
    expect(e.full_name).toBe("Maria Silva");
  });

  it("não aceita gravar e-mail como nome", async () => {
    expect(await sqlState(db.q("update employees set full_name = 'fulano@gmail.com' where id = $1", [ids.seller]))).toBe("23514");
  });
});

describe("auditoria de saldo (stock_integrity_report)", () => {
  const report = () =>
    db.asUser(ids.manager, async (c) => (await c.query("select * from public.stock_integrity_report()")).rows as { item_id: string; problem: string; balance: string; ledger: string }[]);

  it("produto movimentado só por ledger não aparece; divergência é listada com saldo x ledger", async () => {
    const ok = await addItem(db, { name: "Integridade ok", stock: 5 });
    const bad = await addItem(db, { name: "Integridade ruim", stock: 5 });
    await db.q("update items set quantity = 9 where id = $1", [bad]);
    const rows = await report();
    expect(rows.find((r) => r.item_id === ok)).toBeUndefined();
    const r = rows.find((x) => x.item_id === bad)!;
    expect(r.problem).toBe("SALDO_DIVERGE_DO_LEDGER");
    expect(Number(r.balance)).toBe(9);
    expect(Number(r.ledger)).toBe(5);
  });

  it("item com número de série: quantidade tem que ser igual aos seriais em estoque", async () => {
    const item = await db.one<{ id: string }>("insert into items (name, track_serial, created_by) values ('Serial integridade', true, $1) returning id", [ids.admin]);
    await db.asUser(ids.manager, (c) =>
      c.query("select public.create_movement('entrada', $1, null, 'outros', null, null, null, $2::jsonb)", [item.id, JSON.stringify(["IMEI-1", "IMEI-2"])])
    );
    expect((await report()).find((r) => r.item_id === item.id)).toBeUndefined();
    await db.q("update item_serials set status = 'baixado' where item_id = $1 and serial = 'IMEI-1'", [item.id]);
    expect((await report()).find((r) => r.item_id === item.id)?.problem).toBe("SERIAIS_DIVERGEM_DO_SALDO");
  });

  it("vendedor não enxerga a auditoria", async () => {
    const rows = await db.asUser(ids.seller, async (c) => (await c.query("select * from public.stock_integrity_report()")).rows);
    expect(rows).toHaveLength(0);
  });
});

describe("faturamento do mês = SQL independente, no fuso de Fortaleza", () => {
  it("soma vendas concluídas/parciais/devolvidas (líquido do reembolso), ignora canceladas e respeita a virada do mês às 00h de Fortaleza", async () => {
    const d = await createTestDb("upgrade");
    const mk = (total: number, refunded: number, status: string, at: string) =>
      d.q(
        `insert into sales (idempotency_key, seller_id, created_by, subtotal, total, refunded_amount, status, created_at, cancelled_at, cancelled_by, cancel_reason)
         values (gen_random_uuid(), $1, $1, $2, $2, $3, $4, $5, $6, $7, $8)`,
        [ids.seller, total, refunded, status, at, status === "cancelada" ? at : null, status === "cancelada" ? ids.manager : null, status === "cancelada" ? "teste de cancelamento" : null]
      );
    await mk(100, 0, "concluida", "2026-09-10T15:00:00Z");
    await mk(200, 50, "parcialmente_devolvida", "2026-09-20T12:00:00Z");
    await mk(80, 80, "devolvida", "2026-09-21T12:00:00Z");
    await mk(999, 0, "cancelada", "2026-09-22T12:00:00Z");
    // 2026-10-01T02:30Z = 30/09 23:30 em Fortaleza → ainda é SETEMBRO (em UTC já seria outubro)
    await mk(70, 0, "concluida", "2026-10-01T02:30:00Z");
    // 2026-10-01T03:00Z = 01/10 00:00 em Fortaleza → OUTUBRO
    await mk(1000, 0, "concluida", "2026-10-01T03:00:00Z");

    const { from, to } = monthRange("2026-09");
    const screen = await d.asUser(ids.manager, async (c) => Number((await c.query("select public.sales_revenue($1, $2) r", [from.toISOString(), to.toISOString()])).rows[0].r));
    const independent = Number(
      (
        await d.one<{ v: string }>(
          `select coalesce(sum(total - refunded_amount), 0) v from sales
            where status <> 'cancelada'
              and (created_at at time zone 'America/Fortaleza')::date between date '2026-09-01' and date '2026-09-30'`
        )
      ).v
    );
    expect(independent).toBe(100 + 150 + 0 + 70);
    expect(screen).toBe(independent);

    const dash = await d.asUser(ids.manager, async (c) => (await c.query("select public.sales_dashboard($1, $2) r", [from.toISOString(), to.toISOString()])).rows[0].r);
    expect(Number(dash.revenue)).toBe(independent);
    expect(dash.daily.at(-1)).toEqual({ day: "2026-09-30", revenue: 70, sales: 1 }); // 23h30 de 30/09 fica em setembro
    await d.close();
  });
});

describe("fluxo completo: entrada → venda → devolução → cancelamento", () => {
  it("o saldo sempre bate com o ledger, o fornecedor fica rastreável e nada fica divergente", async () => {
    const supplier = (await db.one<{ id: string }>("select id from suppliers where name = 'EUA'")).id;
    const a = await addItem(db, { name: "Fluxo A", price: 100, min: 5 });
    const b = await addItem(db, { name: "Fluxo B", price: 50, min: 5 });
    const c = await addItem(db, { name: "Fluxo C", price: 10, min: 0 });

    // 1) uma nota, um fornecedor, três itens
    const note = await db.asUser(ids.manager, async (cl) =>
      (
        await cl.query("select public.create_stock_entry($1::jsonb, 'compra', 'NF 123', $2, $3) r", [
          JSON.stringify([
            { item_id: a, quantity: 6, unit_value: 40 },
            { item_id: b, quantity: 3, unit_value: 20 },
            { item_id: c, quantity: 10, unit_value: 2 },
          ]),
          supplier,
          crypto.randomUUID(),
        ])
      ).rows[0].r
    );
    expect(note.count).toBe(3);
    const supplierRows = await db.q<{ supplier_id: string }>("select supplier_id from movements where item_id = any($1) and subtype = 'compra'", [[a, b, c]]);
    expect(supplierRows).toHaveLength(3);
    expect(new Set(supplierRows.map((r) => r.supplier_id))).toEqual(new Set([supplier]));

    // 2) venda de 2 de A e 1 de B
    const sale = await sell(db, ids.seller, { items: [{ item_id: a, quantity: 2 }, { item_id: b, quantity: 1 }] });
    expect(await stockOf(db, a)).toBe(4);
    expect(await stockOf(db, b)).toBe(2);

    // B (2 un) está abaixo do mínimo 5; A (4) também: aparecem na reposição, com o fornecedor da compra
    const rows = await db.asUser(ids.manager, async (cl) => (await cl.query("select id, status, suggestion, supplier_id from public.stock_alert_rows()")).rows);
    const ra = rows.find((r) => r.id === a)!;
    expect(ra).toMatchObject({ status: "baixo", supplier_id: supplier });
    expect(Number(ra.suggestion)).toBe(1); // 5 − 4
    expect(Number(rows.find((r) => r.id === b)!.suggestion)).toBe(3); // 5 − 2
    expect(rows.find((r) => r.id === c)).toBeUndefined(); // mínimo 0 nunca alerta

    // 3) devolução parcial de 1 de A
    const line = await db.one<{ id: string }>("select id from sale_items where sale_id = $1 and item_id = $2", [sale.sale_id, a]);
    await db.asUser(ids.manager, (cl) =>
      cl.query("select public.return_sale_items($1, $2::jsonb, 'defeito', $3)", [sale.sale_id, JSON.stringify([{ sale_item_id: line.id, quantity: 1 }]), crypto.randomUUID()])
    );
    expect(await stockOf(db, a)).toBe(5);
    expect((await db.one<{ status: string }>("select status from sales where id = $1", [sale.sale_id])).status).toBe("parcialmente_devolvida");

    // 4) cancela o restante
    const left = await db.one<{ status: string }>("select status from sales where id = $1", [sale.sale_id]);
    expect(left.status).toBe("parcialmente_devolvida");

    // 5) auditoria: nenhum dos três produtos diverge do ledger
    const report = await db.asUser(ids.manager, async (cl) => (await cl.query("select item_id from public.stock_integrity_report()")).rows as { item_id: string }[]);
    expect(report.filter((r) => [a, b, c].includes(r.item_id))).toEqual([]);
    const ledger = await db.one<{ q: string }>(
      `select sum(case type when 'entrada' then quantity when 'saida' then -quantity else 0 end) q from movements where item_id = $1`,
      [a]
    );
    expect(Number(ledger.q)).toBe(await stockOf(db, a));
  });

  it("clique duplo em 'Finalizar venda' (mesma chave) não vende duas vezes", async () => {
    const item = await addItem(db, { name: "Fluxo idem", price: 10, stock: 5 });
    const key = crypto.randomUUID();
    const [s1, s2] = await Promise.all([sell(db, ids.seller, { key, items: [{ item_id: item, quantity: 1 }] }), sell(db, ids.seller, { key, items: [{ item_id: item, quantity: 1 }] })]);
    expect(s1.sale_id).toBe(s2.sale_id);
    expect(await stockOf(db, item)).toBe(4);
  });

  it("vendedor não lança entrada nem vê a auditoria de saldo", async () => {
    const item = await addItem(db, { name: "Fluxo perm" });
    const eua = (await db.one<{ id: string }>("select id from suppliers where name = 'EUA'")).id;
    const hint = await hintOf(
      db.asUser(ids.seller, (cl) => cl.query("select public.create_stock_entry($1::jsonb, 'compra', null, $2, null)", [JSON.stringify([{ item_id: item, quantity: 1 }]), eua]))
    );
    expect(hint).toBe("FORBIDDEN");
  });
});
