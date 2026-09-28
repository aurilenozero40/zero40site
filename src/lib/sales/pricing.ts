/**
 * Cálculo de totais da venda — espelho EXATO do que create_sale faz no banco.
 * Serve para mostrar o resumo na tela antes de confirmar. Quem vale é o banco:
 * o servidor recalcula tudo e recusa o que não bater com as regras.
 *
 * Tudo em CENTAVOS (inteiros) para nunca ter erro de ponto flutuante.
 * Arredondamento: meio para cima, igual ao round() do Postgres em valores positivos.
 */

export const PAYMENT_METHODS = ["pix", "dinheiro", "debito", "credito_vista", "credito_parcelado"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  pix: "PIX",
  dinheiro: "Dinheiro",
  debito: "Débito",
  credito_vista: "Crédito à vista",
  credito_parcelado: "Crédito parcelado",
};

export const isCardMethod = (m: PaymentMethod) => m === "debito" || m === "credito_vista" || m === "credito_parcelado";

export const MAX_INSTALLMENTS = 18;

export const toCents = (value: number) => Math.round(value * 100);
export const fromCents = (cents: number) => cents / 100;

/** round-half-up de numerador/denominador inteiros (positivos). */
const divRound = (numerator: number, denominator: number) => Math.floor((numerator + denominator / 2) / denominator);

/** Total de uma linha: preço unitário × quantidade (até 3 casas). */
export function lineTotalCents(unitPriceCents: number, quantity: number): number {
  return divRound(unitPriceCents * Math.round(quantity * 1000), 1000);
}

/** Percentual com 3 casas (como o banco guarda) sobre um valor em centavos. */
export function percentOfCents(cents: number, percent: number): number {
  return divRound(cents * Math.round(percent * 1000), 100_000);
}

export interface PricingInput {
  subtotalCents: number;
  discountCents: number;
  method: PaymentMethod;
  installments: number;
  interestPercent: number;
  /** valor do produto recebido como entrada (troca) — abate o total, fora do limite de desconto */
  tradeInCents?: number;
}

export interface PricingResult {
  subtotalCents: number;
  discountCents: number;
  /** subtotal − desconto (o "valor da venda", antes de juros) */
  baseCents: number;
  interestCents: number;
  tradeInCents: number;
  /** o que o cliente paga: base + juros − entrada */
  totalCents: number;
  /** valor de cada parcela (total ÷ parcelas) */
  installmentCents: number;
}

export function computeSaleTotals(input: PricingInput): PricingResult {
  const baseCents = input.subtotalCents - input.discountCents;
  const interestCents =
    input.method === "credito_parcelado" ? percentOfCents(baseCents, input.interestPercent) : 0;
  const tradeInCents = input.tradeInCents ?? 0;
  const totalCents = baseCents + interestCents - tradeInCents;
  const installments = input.method === "credito_parcelado" ? Math.max(1, input.installments) : 1;
  return {
    subtotalCents: input.subtotalCents,
    discountCents: input.discountCents,
    baseCents,
    interestCents,
    tradeInCents,
    totalCents,
    installmentCents: divRound(totalCents, installments),
  };
}

/** Taxa da operadora (custo da loja) sobre o que o cliente pagou, e o líquido que sobra. */
export function computeCardFee(totalCents: number, feePercent: number) {
  const feeCents = percentOfCents(totalCents, feePercent);
  return { feeCents, netCents: totalCents - feeCents };
}

/** Chave da tabela card_fee_rates: 0 = débito, 1 = crédito à vista, N = N parcelas. */
export function feeKey(method: PaymentMethod, installments: number): number | null {
  if (method === "debito") return 0;
  if (method === "credito_vista") return 1;
  if (method === "credito_parcelado") return installments;
  return null;
}

/** Desconto em R$ (centavos) para um percentual do subtotal. */
export function discountFromPercent(subtotalCents: number, percent: number): number {
  return percentOfCents(subtotalCents, percent);
}

/** Maior desconto (centavos) permitido por um limite percentual — nunca passa do limite. */
export function maxDiscountCents(subtotalCents: number, limitPercent: number): number {
  return Math.min(subtotalCents, Math.floor((subtotalCents * Math.round(limitPercent * 1000)) / 100_000));
}
