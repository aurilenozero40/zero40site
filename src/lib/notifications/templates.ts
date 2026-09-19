import { formatDateTimeBr } from "@/lib/dates";
import { brandLabel } from "@/lib/sales/brands";
import type { PaymentMethod } from "@/lib/sales/pricing";
import type { EventType, RenderedMessage } from "./types";

// ---------------------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------------------
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

export const money = (v: unknown) => brl.format(Number(v ?? 0)).replace(/ /g, " ");
const qty = (v: unknown) => num.format(Number(v ?? 0));

/** Nomes vêm de cadastro (usuário digita): escapa para o modo HTML do Telegram. */
export const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const bold = (s: string) => `<b>${s}</b>`;

/** Bloco "título:\nvalor" no estilo das mensagens do CEO. */
const field = (emoji: string, label: string, value: string) => `${emoji} ${label}:\n${value}`;

const when = (payload: Payload) => {
  const at = payload.occurred_at;
  return typeof at === "string" || at instanceof Date ? formatDateTimeBr(at) : "";
};

// ---------------------------------------------------------------------------------------
// Payloads (fotos gravadas pelo banco no momento do evento)
// ---------------------------------------------------------------------------------------
type Payload = Record<string, unknown>;

interface SaleLine {
  name: string;
  quantity: number;
  unit_price?: number;
}
interface StockChange {
  name: string;
  before: number;
  after: number;
}
interface PaymentInfo {
  method: PaymentMethod;
  installments: number;
  installment_value: number;
  interest_percent: number;
  card_brand: string | null;
  fee_percent: number | null;
  fee_amount: number | null;
  net_amount: number | null;
}


/** "Cartão de crédito", "PIX"… conforme a forma de pagamento. */
function paymentTitle(p: PaymentInfo): string {
  switch (p.method) {
    case "pix":
    case "dinheiro":
      return p.method === "pix" ? "PIX" : "Dinheiro (à vista)";
    case "debito":
      return `Cartão de débito · ${brandLabel(p.card_brand)}`;
    case "credito_vista":
      return `Cartão de crédito à vista · ${brandLabel(p.card_brand)}`;
    default:
      return `Cartão de crédito · ${brandLabel(p.card_brand)}`;
  }
}

// ---------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------
export function renderSaleCompleted(p: Payload): RenderedMessage {
  const items = (p.items as SaleLine[]) ?? [];
  const stock = (p.stock as StockChange[]) ?? [];
  const pay = p.payment as PaymentInfo;
  const discount = Number(p.discount ?? 0);
  const interest = Number(p.interest ?? 0);
  const subtotal = Number(p.subtotal ?? 0);
  const base = subtotal - discount;

  const blocks: string[] = [
    bold("🔔 VENDA REALIZADA!"),
    field("👤", "Vendedor", escapeHtml(p.seller)),
    field("🧑", "Cliente", p.customer ? escapeHtml(p.customer) : "Não informado"),
    `🛒 Produtos:\n${items.map((i) => `• ${escapeHtml(i.name)} — ${qty(i.quantity)}x`).join("\n")}`,
  ];

  // Venda simples (sem desconto nem juros): um único valor, sem repetir o mesmo número.
  const simple = discount === 0 && interest === 0;
  if (simple) {
    blocks.push(field("💵", "Valor da venda", money(base)));
  } else {
    blocks.push(field("💰", "Subtotal", money(subtotal)));
    if (discount > 0) blocks.push(field("🏷️", "Desconto", money(discount)));
    blocks.push(field("💵", "Valor da venda", money(base)));
  }

  blocks.push(field("💳", "Pagamento", paymentTitle(pay)));

  if (pay.method === "credito_parcelado") {
    blocks.push(field("📆", "Parcelamento", `${pay.installments}x de ${money(pay.installment_value)}`));
    if (interest > 0) {
      blocks.push(field("📈", "Juros", `${money(interest)} (${pct.format(Number(pay.interest_percent))}%)`));
      blocks.push(field("💰", "Total com juros", money(Number(p.total))));
    }
  }

  // Custo da operadora e o que realmente entra: o dono precisa enxergar a margem.
  if (pay.fee_amount !== null && pay.fee_amount !== undefined) {
    blocks.push(
      field("🏦", `Taxa da operadora (${pct.format(Number(pay.fee_percent))}%)`, money(pay.fee_amount)),
      field("💼", "Líquido a receber", money(pay.net_amount))
    );
  }

  if (stock.length > 0) {
    blocks.push(`📦 Estoque atualizado:\n${stock.map((s) => `${escapeHtml(s.name)}: ${qty(s.before)} → ${qty(s.after)}`).join("\n")}`);
  }

  blocks.push(`🕐 ${when(p)}`, `ID da venda:\n#${escapeHtml(p.code)}`);
  return { text: blocks.join("\n\n"), parseMode: "HTML" };
}

export function renderSaleCancelled(p: Payload): RenderedMessage {
  const blocks = [
    bold("🔴 VENDA CANCELADA"),
    field("🧾", "Venda", `#${escapeHtml(p.code)}`),
    field("👤", "Vendedor", escapeHtml(p.seller)),
    field("🧑", "Cliente", p.customer ? escapeHtml(p.customer) : "Não informado"),
    field("💵", "Valor", money(p.total)),
    field("🙋", "Cancelado por", escapeHtml(p.cancelled_by)),
    field("📝", "Motivo", escapeHtml(p.reason)),
    `🕐 ${when(p)}`,
  ];
  return { text: blocks.join("\n\n"), parseMode: "HTML" };
}

export function renderSaleReturned(p: Payload): RenderedMessage {
  const items = (p.items as SaleLine[]) ?? [];
  const blocks = [
    bold(p.full ? "↩️ DEVOLUÇÃO TOTAL" : "↩️ DEVOLUÇÃO PARCIAL"),
    field("🧾", "Venda", `#${escapeHtml(p.code)}`),
    field("👤", "Vendedor", escapeHtml(p.seller)),
    field("🧑", "Cliente", p.customer ? escapeHtml(p.customer) : "Não informado"),
    `📦 Devolvido:\n${items.map((i) => `• ${escapeHtml(i.name)} — ${qty(i.quantity)}x`).join("\n")}`,
    field("💸", "Valor a reembolsar", money(p.refund)),
    field("🙋", "Registrado por", escapeHtml(p.returned_by)),
    field("📝", "Motivo", escapeHtml(p.reason)),
    `🕐 ${when(p)}`,
  ];
  return { text: blocks.join("\n\n"), parseMode: "HTML" };
}

export function renderLowStock(p: Payload): RenderedMessage {
  const unit = escapeHtml(p.unit ?? "un");
  const blocks = [
    bold("⚠️ ESTOQUE BAIXO"),
    field("📦", "Produto", escapeHtml(p.name)),
    field("📉", "Estoque atual", `${qty(p.quantity)} ${unit}`),
    field("📌", "Estoque mínimo", `${qty(p.min_stock)} ${unit}`),
  ];
  return { text: blocks.join("\n\n"), parseMode: "HTML" };
}

export function renderOutOfStock(p: Payload): RenderedMessage {
  const blocks = [bold("🚨 PRODUTO ESGOTADO"), field("📦", "Produto", escapeHtml(p.name))];
  if (p.sku) blocks.push(field("🏷️", "SKU", escapeHtml(p.sku)));
  return { text: blocks.join("\n\n"), parseMode: "HTML" };
}

export function renderStockEntry(p: Payload): RenderedMessage {
  const unit = escapeHtml(p.unit ?? "un");
  const blocks = [
    bold("📥 ENTRADA DE ESTOQUE"),
    field("📦", "Produto", escapeHtml(p.name)),
    field("➕", "Quantidade recebida", `${qty(p.added)} ${unit}`),
    field("📊", "Estoque atual", `${qty(p.quantity)} ${unit}`),
    `🕐 ${when(p)}`,
  ];
  return { text: blocks.join("\n\n"), parseMode: "HTML" };
}

const RENDERERS: Record<EventType, (p: Payload) => RenderedMessage> = {
  SALE_COMPLETED: renderSaleCompleted,
  SALE_CANCELLED: renderSaleCancelled,
  SALE_RETURNED: renderSaleReturned,
  LOW_STOCK: renderLowStock,
  OUT_OF_STOCK: renderOutOfStock,
  STOCK_ENTRY: renderStockEntry,
};

/** Mensagem pronta para o evento. `sentAt` habilita o aviso de envio atrasado. */
export function renderMessage(event: EventType, payload: Payload, opts: { sentAt?: Date } = {}): RenderedMessage {
  const render = RENDERERS[event];
  if (!render) throw new Error(`Evento sem template: ${event}`);
  const message = render(payload);

  const occurred = payload.occurred_at ? new Date(String(payload.occurred_at)) : null;
  if (occurred && opts.sentAt && opts.sentAt.getTime() - occurred.getTime() > 10 * 60_000) {
    message.text += `\n\n⏳ Enviada com atraso (evento das ${formatDateTimeBr(occurred).split(" às ")[1]})`;
  }
  return message;
}
