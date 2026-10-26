import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Trava estática: toda rota restrita TEM que chamar o guarda de papel no servidor (não basta esconder o
 * botão/menu). Se alguém criar uma tela nova de gerente/admin sem o guarda, este teste falha.
 * A imposição de verdade das ações (RLS + funções do banco) é testada em tests/db/security.test.ts.
 */
const app = path.resolve(__dirname, "..", "..", "src", "app", "(app)");
const read = (...p: string[]) => fs.readFileSync(path.join(app, ...p), "utf8");

const ADMIN_ONLY = ["configuracoes/page.tsx", "funcionarios/page.tsx", "funcionarios/novo/page.tsx"];
const MANAGER_ONLY = [
  "movimentacoes/page.tsx",
  "movimentacoes/nova/page.tsx",
  "itens/novo/page.tsx",
  "itens/kits/page.tsx",
  "relatorios/caixa/page.tsx",
  "relatorios/categorias/page.tsx",
  "relatorios/entradas/page.tsx",
  "relatorios/garantias/page.tsx",
  "relatorios/reposicao/page.tsx",
  "relatorios/saidas/page.tsx",
];

describe("rotas restritas chamam o guarda de papel no servidor", () => {
  it.each(ADMIN_ONLY)("%s exige admin/CEO", (file) => {
    expect(read(file)).toMatch(/requireAdmin\(/);
  });

  it.each(MANAGER_ONLY)("%s exige gerente ou superior", (file) => {
    expect(read(file)).toMatch(/requireManager\(|requireAdmin\(/);
  });

  it("não existe tela nova sem guarda: toda página fora da lista de livres está coberta", () => {
    const FREE_FOR_SELLER = new Set([
      "buscar-serial/page.tsx",
      "clientes/[id]/page.tsx",
      "clientes/novo/page.tsx",
      "clientes/page.tsx",
      "dashboard/page.tsx",
      "itens/[id]/page.tsx",
      "itens/page.tsx",
      "vendas/[id]/page.tsx",
      "vendas/nova/page.tsx",
      "vendas/page.tsx",
    ]);
    const all: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name === "page.tsx") all.push(path.relative(app, full).split(path.sep).join("/"));
      }
    };
    walk(app);
    const covered = new Set([...ADMIN_ONLY, ...MANAGER_ONLY, ...FREE_FOR_SELLER]);
    expect(all.filter((f) => !covered.has(f))).toEqual([]);
  });

  it("páginas livres para o vendedor ainda exigem funcionário ativo logado", () => {
    for (const f of ["dashboard/page.tsx", "vendas/page.tsx", "vendas/nova/page.tsx", "itens/page.tsx", "clientes/page.tsx", "buscar-serial/page.tsx"]) {
      expect(read(f)).toMatch(/requireEmployee\(|requireManager\(/);
    }
  });
});

describe("ações do servidor de áreas restritas conferem o papel", () => {
  it("movimentações e produtos: gerente+ (isManager)", () => {
    expect(read("movimentacoes/actions.ts")).toMatch(/isManager\(/);
    expect(read("itens/actions.ts")).toMatch(/isManager\(/);
    expect(read("itens/kits/actions.ts")).toMatch(/isManager\(/);
  });

  it("funcionários e configurações: admin/CEO", () => {
    expect(read("funcionarios/actions.ts")).toMatch(/isAdmin\(/);
    expect(read("configuracoes/actions.ts")).toMatch(/isAdmin\(/);
  });

  it("rota de criação de funcionário (usa a chave de serviço) confere admin", () => {
    const route = fs.readFileSync(path.resolve(__dirname, "..", "..", "src", "app", "api", "employees", "route.ts"), "utf8");
    expect(route).toMatch(/isAdmin\(/);
  });
});
