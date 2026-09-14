// Tabela de taxas negociada com a operadora de cartão. Atualizar aqui sempre
// que a operadora repassar uma tabela nova (a fonte original foi um print
// enviado pelo dono do negócio, sem link/API pra manter isso sincronizado
// sozinho — é edição manual mesmo).
export type CardBrand = "visa" | "mastercard" | "elo" | "hipercard" | "amex" | "outro";

type FeeRow = {
  debito: number | null;
  credito: Record<number, number>; // parcela (1-18) -> taxa em %
};

const CARD_FEE_TABLE: Record<Exclude<CardBrand, "outro">, FeeRow> = {
  mastercard: {
    debito: 1.0,
    credito: {
      1: 3.3, 2: 3.88, 3: 4.46, 4: 5.44, 5: 6.09, 6: 6.51, 7: 7.39, 8: 8.04,
      9: 8.79, 10: 8.89, 11: 9.84, 12: 9.88, 13: 10.49, 14: 10.98, 15: 11.49,
      16: 11.99, 17: 12.48, 18: 12.94,
    },
  },
  visa: {
    debito: 1.0,
    credito: {
      1: 3.3, 2: 3.88, 3: 4.46, 4: 5.44, 5: 6.09, 6: 6.51, 7: 7.39, 8: 8.04,
      9: 8.79, 10: 8.89, 11: 9.84, 12: 9.88, 13: 10.49, 14: 10.98, 15: 11.49,
      16: 11.99, 17: 12.48, 18: 12.94,
    },
  },
  elo: {
    debito: 1.89,
    credito: {
      1: 4.0, 2: 6.18, 3: 6.76, 4: 7.74, 5: 8.39, 6: 8.81, 7: 9.89, 8: 10.54,
      9: 11.29, 10: 11.39, 11: 12.34, 12: 12.38, 13: 13.19, 14: 13.68,
      15: 14.19, 16: 14.69, 17: 15.18, 18: 15.64,
    },
  },
  hipercard: {
    debito: null, // operadora não oferece débito pra essa bandeira
    credito: {
      1: 0, 2: 1.89, 3: 2.47, 4: 3.45, 5: 4.1, 6: 4.52, 7: 5.6, 8: 6.25,
      9: 7.0, 10: 7.1, 11: 8.05, 12: 8.09, 13: 8.9, 14: 9.39, 15: 9.9,
      16: 10.4, 17: 10.89, 18: 11.35,
    },
  },
  amex: {
    debito: null, // operadora não oferece débito pra essa bandeira
    credito: {
      1: 4.0, 2: 6.18, 3: 6.76, 4: 7.74, 5: 8.39, 6: 8.81, 7: 9.89, 8: 10.54,
      9: 11.29, 10: 11.39, 11: 12.34, 12: 12.38, 13: 13.19, 14: 13.68,
      15: 14.19, 16: 14.69, 17: 15.18, 18: 15.64,
    },
  },
};

// Ordem e nomes seguem exatamente a tabela de taxas repassada (Master, Visa,
// Elo, Hiper, Amex) — não reordenar/renomear sem conferir com a tabela.
export const CARD_BRANDS: { value: CardBrand; label: string }[] = [
  { value: "mastercard", label: "Master" },
  { value: "visa", label: "Visa" },
  { value: "elo", label: "Elo" },
  { value: "hipercard", label: "Hiper" },
  { value: "amex", label: "Amex" },
  { value: "outro", label: "Outro" },
];

export const CREDIT_INSTALLMENTS = Array.from({ length: 18 }, (_, i) => i + 1);

/** Taxa (%) pra bandeira/parcela, ou null se não tiver taxa cadastrada (ex: débito em bandeira sem débito, ou "Outro"). */
export function getCardFeeRate(
  brand: string,
  isDebit: boolean,
  installments: number
): number | null {
  const row = CARD_FEE_TABLE[brand as keyof typeof CARD_FEE_TABLE];
  if (!row) return null;
  return isDebit ? row.debito : (row.credito[installments] ?? null);
}
