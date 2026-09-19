import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 54998;
const root = path.resolve(__dirname, "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf8");

/**
 * Sobe UM Postgres real (embarcado) para toda a suíte e monta dois bancos-modelo:
 *
 *  • template_upgrade — o banco de PRODUÇÃO como está hoje (schema antigo + drift + as duas
 *    migrations já coladas lá) com o supabase/schema.sql NOVO rodado por cima. É o caminho
 *    real de atualização, então prova que rodar o arquivo em produção funciona.
 *  • template_fresh   — banco vazio + só o supabase/schema.sql (instalação do zero).
 *
 * Cada arquivo de teste clona um deles em milissegundos.
 */
export default async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "estoque-pg-"));
  const server = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "pw",
    port: PORT,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"], // como no Supabase (no Windows o padrão seria WIN1252)
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();

  const connect = async (database: string) => {
    const c = new pg.Client({ host: "localhost", port: PORT, user: "postgres", password: "pw", database });
    await c.connect();
    return c;
  };

  const admin = await connect("postgres");
  await admin.query("create database template_upgrade");
  await admin.query("create database template_fresh");
  await admin.end();

  const schema = read("supabase", "schema.sql");
  const stub = read("tests", "db", "stub.sql");

  // ---- atualização: produção hoje + schema.sql novo -------------------------------------
  const up = await connect("template_upgrade");
  await up.query(stub);
  await up.query(read("tests", "db", "legacy-1-schema.sql"));
  await up.query(read("tests", "db", "drift.sql"));
  await up.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
       ('00000000-0000-0000-0000-0000000000a1', 'anderson@loja.com', '{"full_name":"Anderson"}'),
       ('00000000-0000-0000-0000-0000000000a2', 'aurileno@loja.com', '{"full_name":"Aurileno"}');
     update employees set role = 'admin';`
  );
  await up.query(read("tests", "db", "legacy-2-applied.sql"));
  await up.query(schema);
  await up.end();

  // ---- instalação nova -----------------------------------------------------------------------
  const fresh = await connect("template_fresh");
  await fresh.query(stub);
  await fresh.query(schema);
  await fresh.end();

  process.env.TEST_PG_PORT = String(PORT);

  return async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}
