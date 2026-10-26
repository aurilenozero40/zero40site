import { describe, expect, it } from "vitest";
import { findDuplicateCustomers, phonesSimilar } from "@/lib/customers";

const c = (id: string, name: string, phone: string | null) => ({ id, name, phone, whatsapp: null });

describe("cliente duplicado", () => {
  it("telefone igual ou com 1 dígito de diferença é parecido (KAKA LOIOLA)", () => {
    expect(phonesSimilar("(85) 98809-3606", "85998093606")).toBe(true); // formatado x só dígitos, 1 dígito diferente
    expect(phonesSimilar("85988093606", "85998093606")).toBe(true); // diferem em 1 dígito
    expect(phonesSimilar("85988093606", "85988093606")).toBe(true);
    expect(phonesSimilar("85988093606", "8588093606")).toBe(false); // tamanhos diferentes
    expect(phonesSimilar(null, "85988093606")).toBe(false);
  });

  it("acha por nome (sem acento/caixa) ou por telefone parecido", () => {
    const existing = [c("1", "KAKA LOIOLA", "85988093606"), c("2", "Rubens SF", "85987798200"), c("3", "Maria", null)];
    expect(findDuplicateCustomers({ name: "kaka loiola", phone: "85998093606" }, existing).map((x) => x.id)).toEqual(["1"]);
    expect(findDuplicateCustomers({ name: "Rubens  sf" }, existing).map((x) => x.id)).toEqual(["2"]);
    expect(findDuplicateCustomers({ name: "Fulano", phone: "85988093607" }, existing).map((x) => x.id)).toEqual(["1"]);
    expect(findDuplicateCustomers({ name: "Fulano", phone: "11999990000" }, existing)).toEqual([]);
  });
});
