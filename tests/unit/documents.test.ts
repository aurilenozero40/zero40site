import { describe, expect, it } from "vitest";
import { formatDocument, formatPhone, isValidCnpj, isValidCpf, isValidDocument, onlyDigits } from "@/lib/documents";

describe("CPF / CNPJ", () => {
  it("valida CPF pelos dígitos verificadores", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("123")).toBe(false);
  });

  it("valida CNPJ pelos dígitos verificadores", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
    expect(isValidCnpj("00000000000000")).toBe(false);
  });

  it("isValidDocument escolhe CPF ou CNPJ pelo tamanho", () => {
    expect(isValidDocument("52998224725")).toBe(true);
    expect(isValidDocument("11222333000181")).toBe(true);
    expect(isValidDocument("1234567890")).toBe(false);
  });

  it("formata para exibição", () => {
    expect(onlyDigits("529.982.247-25")).toBe("52998224725");
    expect(formatDocument("52998224725")).toBe("529.982.247-25");
    expect(formatDocument("11222333000181")).toBe("11.222.333/0001-81");
    expect(formatPhone("85999990000")).toBe("(85) 99999-0000");
    expect(formatPhone("8533334444")).toBe("(85) 3333-4444");
    expect(formatDocument(null)).toBe("");
  });
});
