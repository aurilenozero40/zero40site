import pg from "pg";
import crypto from "node:crypto";

const port = () => Number(process.env.TEST_PG_PORT);

export type Role = "ceo" | "admin" | "gerente" | "vendedor";

export const ids = {
  admin: "00000000-0000-0000-0000-0000000000a1",
  ceo: "00000000-0000-0000-0000-0000000000c1",
  manager: "00000000-0000-0000-0000-0000000000b1",
  seller: "00000000-0000-0000-0000-0000000000e1",
  seller2: "00000000-0000-0000-0000-0000000000e2",
};

export class TestDb {
  constructor(
    readonly name: string,
    readonly su: pg.Client
  ) {}

  /** Nova conexão de superusuário neste banco (para simular requisições concorrentes). */
  async connect(): Promise<pg.Client> {
    const c = new pg.Client({ host: "localhost", port: port(), user: "postgres", password: "pw", database: this.name });
    await c.connect();
    return c;
  }

  /** Executa `fn` como usuário autenticado (role `authenticated` + auth.uid() = userId), numa transação. */
  async asUser<T>(userId: string, fn: (c: pg.Client) => Promise<T>, client?: pg.Client): Promise<T> {
    const c = client ?? (await this.connect());
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const result = await fn(c);
      await c.query("commit");
      return result;
    } catch (err) {
      await c.query("rollback").catch(() => {});
      throw err;
    } finally {
      if (!client) await c.end();
    }
  }

  /** Executa como anônimo (sem sessão). */
  async asAnon<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
    const c = await this.connect();
    try {
      await c.query("begin");
      await c.query("set local role anon");
      const result = await fn(c);
      await c.query("commit");
      return result;
    } catch (err) {
      await c.query("rollback").catch(() => {});
      throw err;
    } finally {
      await c.end();
    }
  }

  async q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.su.query(sql, params)).rows as T[];
  }

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.q<T>(sql, params);
    return rows[0];
  }

  async close() {
    await this.su.end();
    const admin = new pg.Client({ host: "localhost", port: port(), user: "postgres", password: "pw", database: "postgres" });
    await admin.connect();
    await admin.query(`drop database if exists "${this.name}" with (force)`);
    await admin.end();
  }
}

export type Template = "upgrade" | "fresh";

const RATES: [string, number, number][] = [
  ["master", 0, 1.0], ["master", 1, 3.3], ["master", 2, 3.88], ["master", 10, 8.89], ["master", 12, 9.88],
  ["visa", 0, 1.0], ["visa", 1, 3.3], ["visa", 2, 3.88], ["visa", 10, 8.89], ["visa", 12, 9.88],
  ["elo", 0, 1.89], ["elo", 1, 4.0], ["elo", 10, 11.39],
  ["hiper", 1, 0.0], ["hiper", 2, 1.89], ["hiper", 10, 7.1],
  ["amex", 1, 4.0], ["amex", 2, 6.18],
];

/**
 * Clona um banco-modelo e cria os perfis de teste.
 *  • "upgrade": produção como está hoje + schema.sql novo por cima (padrão)
 *  • "fresh":   instalação do zero só com o schema.sql
 */
export async function createTestDb(template: Template = "upgrade"): Promise<TestDb> {
  const name = "t_" + crypto.randomBytes(6).toString("hex");
  const admin = new pg.Client({ host: "localhost", port: port(), user: "postgres", password: "pw", database: "postgres" });
  await admin.connect();
  await admin.query(`create database "${name}" template template_${template}`);
  await admin.end();

  const su = new pg.Client({ host: "localhost", port: port(), user: "postgres", password: "pw", database: name });
  await su.connect();
  const db = new TestDb(name, su);

  for (const [brand, installments, fee] of RATES) {
    await su.query(
      "insert into card_fee_rates (brand, installments, fee_percent) values ($1,$2,$3) on conflict (brand, installments) do nothing",
      [brand, installments, fee]
    );
  }

  const people: [string, string, Role][] = [
    [ids.admin, "Anderson Admin", "admin"], // já existe no modelo "upgrade" (como em produção)
    [ids.ceo, "Carla CEO", "ceo"],
    [ids.manager, "Marina Gerente", "gerente"],
    [ids.seller, "João Vendedor", "vendedor"],
    [ids.seller2, "Pedro Vendedor", "vendedor"],
  ];
  for (const [id, fullName, role] of people) {
    await su.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3) on conflict (id) do nothing", [
      id,
      `${id.slice(-2)}@loja.com`,
      JSON.stringify({ full_name: fullName }),
    ]);
    await su.query("update employees set role = $2 where id = $1", [id, role]);
  }
  return db;
}

export interface NewItem {
  name: string;
  price?: number | null;
  cost?: number | null;
  stock?: number;
  min?: number;
  barcode?: string | null;
  active?: boolean;
}

/** Cadastra produto e dá entrada no estoque pelo ledger (como o sistema real faz). */
export async function addItem(db: TestDb, i: NewItem): Promise<string> {
  const row = await db.one<{ id: string }>(
    `insert into items (name, sale_price, cost_price, min_stock, barcode, active, created_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [i.name, i.price === undefined ? 100 : i.price, i.cost ?? null, i.min ?? 0, i.barcode ?? null, i.active ?? true, ids.admin]
  );
  if (i.stock && i.stock > 0) {
    await db.q(
      `insert into movements (item_id, type, subtype, quantity, unit_value, reason, created_by)
       values ($1, 'entrada', 'compra', $2, 1, 'estoque inicial (teste)', $3)`,
      [row.id, i.stock, ids.admin]
    );
  }
  return row.id;
}

export async function stockOf(db: TestDb, itemId: string): Promise<number> {
  const r = await db.one<{ quantity: string }>("select quantity from items where id = $1", [itemId]);
  return Number(r.quantity);
}

export interface SaleArgs {
  key?: string;
  customer?: string | null;
  items: { item_id: string; quantity: number }[];
  discount?: number;
  method?: string;
  installments?: number;
  interest?: number;
  brand?: string | null;
  notes?: string | null;
}

export interface SaleResult {
  sale_id: string;
  number: number;
  code: string;
  total: number;
  status: string;
  already_processed: boolean;
}

export async function callCreateSale(c: pg.Client, a: SaleArgs): Promise<SaleResult> {
  const r = await c.query("select public.create_sale($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9) as r", [
    a.key ?? crypto.randomUUID(),
    a.customer ?? null,
    JSON.stringify(a.items),
    a.discount ?? 0,
    a.method ?? "pix",
    a.installments ?? 1,
    a.interest ?? 0,
    a.brand ?? null,
    a.notes ?? null,
  ]);
  return r.rows[0].r as SaleResult;
}

export const sell = (db: TestDb, userId: string, a: SaleArgs) => db.asUser(userId, (c) => callCreateSale(c, a));

/** Erro do Postgres com o código de máquina que as funções devolvem em `hint`. */
export async function hintOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return (e as { hint?: string }).hint ?? `NO_HINT:${(e as Error).message}`;
  }
  return undefined;
}
