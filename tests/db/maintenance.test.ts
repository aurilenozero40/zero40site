import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { addItem, createTestDb, ids, type TestDb } from "./helpers";

/**
 * Os scripts de limpeza (supabase/maintenance) rodam em produção sobre dados reais — aqui provamos
 * num banco de teste que (1) fazem o que dizem, (2) não apagam nada e (3) o desfazer restaura.
 */
let db: TestDb;
beforeAll(async () => {
  db = await createTestDb("upgrade");
});
afterAll(async () => {
  await db.close();
});

const script = (name: string) => fs.readFileSync(path.resolve(__dirname, "..", "..", "supabase", "maintenance", name), "utf8");

/** Preenche o plano e troca o ROLLBACK final por COMMIT (como o dono faria depois de revisar). */
const withPlan = (sql: string, plan: string) => sql.replace(/\nbegin;\n/, `\n${plan}\nbegin;\n`).replace(/rollback;\s*--.*$/m, "commit;");

describe("limpeza reversível de duplicados", () => {
  it("desativa o duplicado (sem apagar), move o saldo por ajustes no ledger, vincula a conta duplicada e o desfazer restaura", async () => {
    const principal = await addItem(db, { name: "GARMIN 265", stock: 2, barcode: "111" });
    const duplicado = await addItem(db, { name: "GARMIN 265 DUP", stock: 3, barcode: "222" });
    await db.q("update items set sku = 'S-265' where id = $1", [duplicado]);
    const oregon = await addItem(db, { name: "temp" });

    const dupAccount = ids.seller2;
    const mainAccount = ids.seller;

    const plan = `
      insert into plano_itens values ('${duplicado}', '${principal}');
      insert into plano_correcoes values ('${oregon}', 'garmin oregon 750', null);
      insert into plano_funcionarios values ('${dupAccount}', '${mainAccount}');`;
    await db.su.query(withPlan(script("02-limpeza-reversivel.sql"), plan));

    const dup = await db.one<{ active: boolean; sku: string; barcode: string; quantity: string }>("select active, sku, barcode, quantity from items where id = $1", [duplicado]);
    expect(dup.active).toBe(false);
    expect(dup.sku).toMatch(/^S-265-DUP-/);
    expect(dup.barcode).toMatch(/^222-DUP-/);
    expect(Number(dup.quantity)).toBe(0);
    expect(Number((await db.one<{ quantity: string }>("select quantity from items where id = $1", [principal])).quantity)).toBe(5); // 2 + 3
    expect((await db.one<{ name: string }>("select name from items where id = $1", [oregon])).name).toBe("GARMIN OREGON 750");

    const emp = await db.one<{ merged_into: string; active: boolean }>("select merged_into, active from employees where id = $1", [dupAccount]);
    expect(emp).toEqual({ merged_into: mainAccount, active: false });

    // nada foi apagado e o saldo continua batendo com o ledger
    expect(Number((await db.one<{ n: string }>("select count(*) n from items where id = any($1)", [[principal, duplicado, oregon]])).n)).toBe(3);
    const bad = await db.q("select * from (select i.id, i.quantity, coalesce(sum(case m.type when 'entrada' then m.quantity when 'saida' then -m.quantity else case when m.adjustment_increases_stock then m.quantity else -m.quantity end end),0) q from items i left join movements m on m.item_id = i.id where i.id = any($1) group by i.id) t where quantity <> q", [[principal, duplicado]]);
    expect(bad).toHaveLength(0);

    // desfazer: nome/SKU/código/ativo e vínculo voltam
    await db.su.query(script("03-desfazer-limpeza.sql").replace(/rollback;\s*--.*$/m, "commit;"));
    const back = await db.one<{ active: boolean; sku: string; barcode: string }>("select active, sku, barcode from items where id = $1", [duplicado]);
    expect(back).toEqual({ active: true, sku: "S-265", barcode: "222" });
    expect((await db.one<{ merged_into: string | null; active: boolean }>("select merged_into, active from employees where id = $1", [dupAccount]))).toEqual({ merged_into: null, active: true });
  });

  it("sem plano preenchido, o script não faz nada (e termina em ROLLBACK por padrão)", async () => {
    const before = await db.one<{ n: string }>("select count(*) n from items where active");
    const c = await db.connect(); // sessão nova: as tabelas temporárias do plano são por sessão
    await c.query(script("02-limpeza-reversivel.sql"));
    await c.end();
    expect((await db.one<{ n: string }>("select count(*) n from items where active")).n).toBe(before.n);
  });
});

describe("filtro e ranking de vendedores: 1 pessoa = 1 vendedor", () => {
  it("o dashboard soma as vendas das contas vinculadas sob a conta principal", async () => {
    const d = await createTestDb("upgrade");
    await d.q("update employees set merged_into = $1 where id = $2", [ids.seller, ids.seller2]);
    await d.q(
      `insert into sales (idempotency_key, seller_id, created_by, subtotal, total, created_at)
       values (gen_random_uuid(), $1, $1, 100, 100, '2026-09-10T15:00:00Z'), (gen_random_uuid(), $2, $2, 50, 50, '2026-09-11T15:00:00Z')`,
      [ids.seller, ids.seller2]
    );
    const r = await d.asUser(ids.ceo, async (c) => (await c.query("select public.sales_dashboard('2026-09-01Z','2026-10-01Z') r")).rows[0].r);
    expect(r.by_seller).toEqual([{ seller: "João Vendedor", revenue: 150, sales: 2 }]);
    await d.close();
  });
});
