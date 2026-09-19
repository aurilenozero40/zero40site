import { describe, expect, it } from "vitest";
import {
  computeCardFee,
  computeSaleTotals,
  discountFromPercent,
  feeKey,
  lineTotalCents,
  maxDiscountCents,
  percentOfCents,
  toCents,
} from "@/lib/sales/pricing";

describe("pricing", () => {
  it("exemplo do CEO: 4.499 − 100 = 4.399 + juros 6,8% = 4.698,13 em 10x", () => {
    const r = computeSaleTotals({
      subtotalCents: toCents(4499),
      discountCents: toCents(100),
      method: "credito_parcelado",
      installments: 10,
      interestPercent: 6.8,
    });
    expect(r.baseCents).toBe(439900);
    expect(r.interestCents).toBe(29913);
    expect(r.totalCents).toBe(469813);
    expect(r.installmentCents).toBe(46981);
  });

  it("juros só existem no crédito parcelado", () => {
    for (const method of ["pix", "dinheiro", "debito", "credito_vista"] as const) {
      const r = computeSaleTotals({ subtotalCents: 100000, discountCents: 0, method, installments: 1, interestPercent: 10 });
      expect(r.interestCents).toBe(0);
      expect(r.totalCents).toBe(100000);
      expect(r.installmentCents).toBe(100000);
    }
  });

  it("R$1.000 + juros R$100 = R$1.100 (valor da venda ≠ valor pago pelo cliente)", () => {
    const r = computeSaleTotals({ subtotalCents: 100000, discountCents: 0, method: "credito_parcelado", installments: 3, interestPercent: 10 });
    expect(r.baseCents).toBe(100000);
    expect(r.interestCents).toBe(10000);
    expect(r.totalCents).toBe(110000);
  });

  it("arredonda meio para cima, em centavos, sem erro de ponto flutuante", () => {
    expect(lineTotalCents(3333, 3)).toBe(9999);
    expect(lineTotalCents(1999, 0.5)).toBe(1000); // 999,5 → 1000
    expect(lineTotalCents(10, 2.5)).toBe(25);
    expect(percentOfCents(10050, 10)).toBe(1005); // 10,05 × 10%
    expect(percentOfCents(5, 10)).toBe(1); // 0,5 centavo → 1
    expect(toCents(0.1 + 0.2)).toBe(30);
  });

  it("taxa da operadora e líquido", () => {
    const r = computeCardFee(469813, 8.89);
    expect(r.feeCents).toBe(41766);
    expect(r.netCents).toBe(428047);
    expect(computeCardFee(100000, 0)).toEqual({ feeCents: 0, netCents: 100000 });
  });

  it("chave da tabela de taxas: débito 0, à vista 1, parcelado N, sem taxa para PIX/dinheiro", () => {
    expect(feeKey("debito", 1)).toBe(0);
    expect(feeKey("credito_vista", 1)).toBe(1);
    expect(feeKey("credito_parcelado", 7)).toBe(7);
    expect(feeKey("pix", 1)).toBeNull();
    expect(feeKey("dinheiro", 1)).toBeNull();
  });

  it("desconto por percentual e teto por limite nunca passam do permitido", () => {
    expect(discountFromPercent(10000, 10)).toBe(1000);
    expect(maxDiscountCents(3333, 10)).toBe(333); // 3,33 (9,99%) — nunca 3,34
    expect(maxDiscountCents(10000, 0)).toBe(0);
    expect(maxDiscountCents(10000, 100)).toBe(10000);
    expect(maxDiscountCents(10000, 150)).toBe(10000); // nunca acima do subtotal
  });
});
