import { describe, expect, it } from "vitest";
import { isAdmin, isManager, isRole, roleRank } from "@/lib/roles";

describe("papéis", () => {
  it("hierarquia igual à do banco (ceo = admin > gerente > vendedor)", () => {
    expect(roleRank("ceo")).toBe(roleRank("admin"));
    expect(roleRank("admin")).toBeGreaterThan(roleRank("gerente"));
    expect(roleRank("gerente")).toBeGreaterThan(roleRank("vendedor"));
    expect(roleRank("staff")).toBe(0);
    expect(roleRank(null)).toBe(0);
  });

  it("quem é gerente+ e quem é admin", () => {
    expect(isManager("gerente")).toBe(true);
    expect(isManager("ceo")).toBe(true);
    expect(isManager("vendedor")).toBe(false);
    expect(isManager("staff")).toBe(false);
    expect(isAdmin("admin")).toBe(true);
    expect(isAdmin("ceo")).toBe(true);
    expect(isAdmin("gerente")).toBe(false);
  });

  it("valida papéis desconhecidos", () => {
    expect(isRole("ceo")).toBe(true);
    expect(isRole("dono")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });
});
