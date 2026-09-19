import type { CardFeeRates } from "@/lib/types";

// Nomes na ordem da tabela de taxas da operadora (Master, Visa, Elo, Hiper, Amex).
export const BRAND_ORDER = ["master", "visa", "elo", "hiper", "amex"] as const;

export const BRAND_LABEL: Record<string, string> = {
  master: "Master",
  visa: "Visa",
  elo: "Elo",
  hiper: "Hiper",
  amex: "Amex",
};

export const brandLabel = (brand: string | null | undefined) =>
  brand ? (BRAND_LABEL[brand.toLowerCase()] ?? brand.toUpperCase()) : "";

/** Bandeiras cadastradas em card_fee_rates, na ordem da tabela. */
export function brandsFrom(rates: CardFeeRates): string[] {
  const known = Object.keys(rates);
  return [...BRAND_ORDER.filter((b) => known.includes(b)), ...known.filter((b) => !(BRAND_ORDER as readonly string[]).includes(b)).sort()];
}

/** Transforma as linhas da tabela card_fee_rates em { bandeira: { parcelas: taxa% } }. */
export function ratesFromRows(rows: { brand: string; installments: number; fee_percent: number | string }[]): CardFeeRates {
  const out: CardFeeRates = {};
  for (const r of rows) {
    const brand = r.brand.toLowerCase();
    (out[brand] ??= {})[Number(r.installments)] = Number(r.fee_percent);
  }
  return out;
}
