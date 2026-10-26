import { describe, expect, it } from "vitest";
import { findItemByCode, looseBarcodeKey, normalizeCode, sameCode } from "@/lib/barcode";

const item = (id: string, name: string, sku: string | null, barcode: string | null) => ({ id, name, sku, barcode });

const catalog = [
  item("1", "CASE GARMIN EDGE 550/850 CINZA", "0101336000", null),
  item("2", "GARMIN 165 PRETO", "010125500", "753759329120"),
  item("3", "GARMIN FENIX 8 PRO PRETO 47MM", "010112513B", "0753759999991"),
  item("4", "PULSEIRA GARMIN 22MM BLACK", "0101325621", null),
];

describe("códigos são texto", () => {
  it("normalizeCode só tira espaços das pontas — nunca o zero à esquerda", () => {
    expect(normalizeCode("  0101336000 \r")).toBe("0101336000");
    expect(normalizeCode(null)).toBe("");
  });

  it("sameCode ignora caixa e espaços, mas não zeros", () => {
    expect(sameCode("010112513b", " 010112513B ")).toBe(true);
    expect(sameCode("0101336000", "101336000")).toBe(false);
    expect(sameCode("", "")).toBe(false);
  });

  it("looseBarcodeKey só serve para ENCONTRAR (UPC-A ↔ EAN-13)", () => {
    expect(looseBarcodeKey("0753759329120")).toBe(looseBarcodeKey("753759329120"));
    expect(looseBarcodeKey("ABC-1")).toBe("abc-1");
  });
});

describe("findItemByCode", () => {
  it("digitar o SKU com zero à esquerda acha o produto (era tratado como produto novo)", () => {
    const r = findItemByCode(catalog, "0101336000");
    expect(r).toMatchObject({ kind: "exact", by: "sku" });
    expect(r.kind === "exact" && r.item.id).toBe("1");
  });

  it("acha por código de barras exato", () => {
    expect(findItemByCode(catalog, "753759329120")).toMatchObject({ kind: "exact", by: "barcode" });
  });

  it("SKU em outra caixa continua achando", () => {
    expect(findItemByCode(catalog, "010112513b")).toMatchObject({ kind: "exact", by: "sku" });
  });

  it("UPC lido como EAN-13 (zero a mais) vira sugestão 'você quis dizer', não produto novo", () => {
    const r = findItemByCode(catalog, "0753759329120");
    expect(r).toMatchObject({ kind: "similar" });
    expect(r.kind === "similar" && r.item.id).toBe("2");
  });

  it("SKU sem o zero à esquerda sugere o produto certo em vez de cadastrar um novo", () => {
    const r = findItemByCode(catalog, "101336000");
    expect(r).toMatchObject({ kind: "similar" });
    expect(r.kind === "similar" && r.item.id).toBe("1");
  });

  it("acha por nome (todas as palavras, sem acento e sem diferenciar caixa)", () => {
    const r = findItemByCode(catalog, "pulseira 22mm");
    expect(r.kind).toBe("names");
    expect(r.kind === "names" && r.items.map((i) => i.id)).toEqual(["4"]);
    const garmin = findItemByCode(catalog, "garmin");
    expect(garmin.kind === "names" && garmin.items.length).toBe(4);
  });

  it("sem nenhum parecido: 'none' (só aí se oferece cadastrar)", () => {
    expect(findItemByCode(catalog, "9999999999999").kind).toBe("none");
    expect(findItemByCode(catalog, "   ").kind).toBe("none");
  });
});
