import { describe, expect, it, vi } from "vitest";
import { renderMessage, escapeHtml, money } from "@/lib/notifications/templates";
import { TelegramChannel } from "@/lib/notifications/telegram";
import { NotificationService } from "@/lib/notifications/service";
import {
  NotificationError,
  type NotificationChannel,
  type OutboxRow,
  type OutboxStore,
  type RenderedMessage,
} from "@/lib/notifications/types";

const OCCURRED = "2026-09-19T17:32:00Z"; // 14:32 em Brasília

const cardSale = {
  code: "VND-000123",
  seller: "João Silva",
  customer: "Carlos Oliveira",
  items: [
    { name: "iPhone 15 128GB", quantity: 1, unit_price: 4000 },
    { name: "Capa MagSafe", quantity: 1, unit_price: 499 },
  ],
  stock: [{ name: "iPhone 15 128GB", before: 7, after: 6 }],
  subtotal: 4499,
  discount: 100,
  interest: 299.13,
  total: 4698.13,
  payment: {
    method: "credito_parcelado",
    installments: 10,
    installment_value: 469.81,
    interest_percent: 6.8,
    card_brand: "master",
    fee_percent: 8.89,
    fee_amount: 417.66,
    net_amount: 4280.47,
  },
  occurred_at: OCCURRED,
};

describe("mensagem de venda (Telegram do CEO)", () => {
  it("crédito parcelado: mostra subtotal, desconto, valor da venda, parcelas, juros e total com juros", () => {
    const { text, parseMode } = renderMessage("SALE_COMPLETED", cardSale);
    expect(parseMode).toBe("HTML");
    expect(text).toContain("<b>🔔 VENDA REALIZADA!</b>");
    expect(text).toContain("👤 Vendedor:\nJoão Silva");
    expect(text).toContain("🧑 Cliente:\nCarlos Oliveira");
    expect(text).toContain("🛒 Produtos:\n• iPhone 15 128GB — 1x\n• Capa MagSafe — 1x");
    expect(text).toContain("💰 Subtotal:\nR$ 4.499,00");
    expect(text).toContain("🏷️ Desconto:\nR$ 100,00");
    expect(text).toContain("💵 Valor da venda:\nR$ 4.399,00");
    expect(text).toContain("💳 Pagamento:\nCartão de crédito · Master");
    expect(text).toContain("📆 Parcelamento:\n10x de R$ 469,81");
    expect(text).toContain("📈 Juros:\nR$ 299,13 (6,8%)");
    expect(text).toContain("💰 Total com juros:\nR$ 4.698,13");
    expect(text).toContain("📦 Estoque atualizado:\niPhone 15 128GB: 7 → 6");
    expect(text).toContain("🕐 19/09/2026 às 14:32");
    expect(text.endsWith("ID da venda:\n#VND-000123")).toBe(true);
  });

  it("mostra a taxa da operadora e o líquido nas vendas de cartão", () => {
    const { text } = renderMessage("SALE_COMPLETED", cardSale);
    expect(text).toContain("🏦 Taxa da operadora (8,89%):\nR$ 417,66");
    expect(text).toContain("💼 Líquido a receber:\nR$ 4.280,47");
  });

  it("PIX simples: sem desconto, sem juros, sem parcelas, sem taxa — e sem repetir o valor", () => {
    const { text } = renderMessage("SALE_COMPLETED", {
      ...cardSale,
      items: [{ name: "Garmin 55 Preto", quantity: 2 }],
      stock: [{ name: "Garmin 55 Preto", before: 5, after: 3 }],
      subtotal: 3000,
      discount: 0,
      interest: 0,
      total: 3000,
      payment: { method: "pix", installments: 1, installment_value: 3000, interest_percent: 0, card_brand: null, fee_percent: null, fee_amount: null, net_amount: null },
    });
    expect(text).toContain("💳 Pagamento:\nPIX");
    expect(text).toContain("• Garmin 55 Preto — 2x");
    expect(text).toContain("💵 Valor da venda:\nR$ 3.000,00");
    for (const absent of ["Desconto", "Juros", "Parcelamento", "Taxa da operadora", "Subtotal", "Total com juros"]) {
      expect(text).not.toContain(absent);
    }
  });

  it("dinheiro, débito e crédito à vista aparecem com o nome certo", () => {
    const base = { ...cardSale, discount: 0, interest: 0, subtotal: 100, total: 100 };
    const pay = (method: string, brand: string | null) => ({ method, installments: 1, installment_value: 100, interest_percent: 0, card_brand: brand, fee_percent: brand ? 1 : null, fee_amount: brand ? 1 : null, net_amount: brand ? 99 : null });
    expect(renderMessage("SALE_COMPLETED", { ...base, payment: pay("dinheiro", null) }).text).toContain("Dinheiro (à vista)");
    expect(renderMessage("SALE_COMPLETED", { ...base, payment: pay("debito", "visa") }).text).toContain("Cartão de débito · Visa");
    expect(renderMessage("SALE_COMPLETED", { ...base, payment: pay("credito_vista", "elo") }).text).toContain("Cartão de crédito à vista · Elo");
  });

  it("venda com desconto no PIX: mostra subtotal, desconto e valor final", () => {
    const { text } = renderMessage("SALE_COMPLETED", {
      ...cardSale,
      subtotal: 1000,
      discount: 50,
      interest: 0,
      total: 950,
      payment: { method: "pix", installments: 1, installment_value: 950, interest_percent: 0, card_brand: null, fee_percent: null, fee_amount: null, net_amount: null },
    });
    expect(text).toContain("💰 Subtotal:\nR$ 1.000,00");
    expect(text).toContain("🏷️ Desconto:\nR$ 50,00");
    expect(text).toContain("💵 Valor da venda:\nR$ 950,00");
    expect(text).not.toContain("Total com juros");
  });

  it("cliente não informado, quantidade fracionada e nomes com HTML são tratados", () => {
    const { text } = renderMessage("SALE_COMPLETED", {
      ...cardSale,
      customer: null,
      seller: "Ana <script>",
      items: [{ name: "Cabo & Cia <USB>", quantity: 2.5 }],
    });
    expect(text).toContain("🧑 Cliente:\nNão informado");
    expect(text).toContain("• Cabo &amp; Cia &lt;USB&gt; — 2,5x");
    expect(text).toContain("Ana &lt;script&gt;");
    expect(text).not.toContain("<script>");
  });

  it("avisa quando a mensagem sai com atraso (Telegram ficou fora do ar)", () => {
    const late = renderMessage("SALE_COMPLETED", cardSale, { sentAt: new Date("2026-09-19T19:00:00Z") });
    expect(late.text).toContain("⏳ Enviada com atraso (evento das 14:32)");
    const onTime = renderMessage("SALE_COMPLETED", cardSale, { sentAt: new Date("2026-09-19T17:33:00Z") });
    expect(onTime.text).not.toContain("atraso");
  });
});

describe("demais mensagens", () => {
  it("venda cancelada", () => {
    const { text } = renderMessage("SALE_CANCELLED", {
      code: "VND-000123", seller: "João Silva", customer: "Carlos Oliveira", total: 4399,
      cancelled_by: "Maria Silva", reason: "Cliente desistiu da compra", occurred_at: OCCURRED,
    });
    expect(text).toContain("<b>🔴 VENDA CANCELADA</b>");
    expect(text).toContain("🧾 Venda:\n#VND-000123");
    expect(text).toContain("👤 Vendedor:\nJoão Silva");
    expect(text).toContain("🧑 Cliente:\nCarlos Oliveira");
    expect(text).toContain("💵 Valor:\nR$ 4.399,00");
    expect(text).toContain("🙋 Cancelado por:\nMaria Silva");
    expect(text).toContain("📝 Motivo:\nCliente desistiu da compra");
  });

  it("devolução parcial e total", () => {
    const base = { code: "VND-000009", seller: "João", customer: null, refund: 100, returned_by: "Marina", reason: "defeito", items: [{ name: "Relógio", quantity: 1 }], occurred_at: OCCURRED };
    expect(renderMessage("SALE_RETURNED", { ...base, full: false }).text).toContain("DEVOLUÇÃO PARCIAL");
    const full = renderMessage("SALE_RETURNED", { ...base, full: true }).text;
    expect(full).toContain("DEVOLUÇÃO TOTAL");
    expect(full).toContain("💸 Valor a reembolsar:\nR$ 100,00");
    expect(full).toContain("• Relógio — 1x");
  });

  it("estoque baixo e produto esgotado", () => {
    const low = renderMessage("LOW_STOCK", { name: "iPhone 15 128GB", quantity: 2, min_stock: 3, unit: "un" }).text;
    expect(low).toContain("<b>⚠️ ESTOQUE BAIXO</b>");
    expect(low).toContain("📦 Produto:\niPhone 15 128GB");
    expect(low).toContain("📉 Estoque atual:\n2 un");
    expect(low).toContain("📌 Estoque mínimo:\n3 un");
    const out = renderMessage("OUT_OF_STOCK", { name: "iPhone 15 128GB", sku: "IPH15" }).text;
    expect(out).toContain("<b>🚨 PRODUTO ESGOTADO</b>");
    expect(out).toContain("📦 Produto:\niPhone 15 128GB");
  });

  it("entrada de estoque", () => {
    const t = renderMessage("STOCK_ENTRY", { name: "Garmin 55", added: 10, quantity: 12, unit: "un", occurred_at: OCCURRED }).text;
    expect(t).toContain("ENTRADA DE ESTOQUE");
    expect(t).toContain("➕ Quantidade recebida:\n10 un");
  });

  it("formata dinheiro e escapa HTML", () => {
    expect(money(1234.5)).toBe("R$ 1.234,50");
    expect(money(0)).toBe("R$ 0,00");
    expect(escapeHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});

// ------------------------------------------------------------------------------------------
describe("canal Telegram", () => {
  const msg: RenderedMessage = { text: "<b>oi</b>", parseMode: "HTML" };
  const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
  const err = (status: number, description: string) => new Response(JSON.stringify({ ok: false, description }), { status });

  it("envia para o chat do CEO com o token vindo da configuração", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok());
    const tg = new TelegramChannel({ token: "123:ABC", chatId: "999", fetchImpl });
    await tg.send(msg);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(JSON.parse(init.body)).toEqual({ chat_id: "999", text: "<b>oi</b>", parse_mode: "HTML", disable_web_page_preview: true });
  });

  it("sem token ou sem chat ID: não está configurado e envio falha como repetível", async () => {
    expect(new TelegramChannel({ token: "x" }).isConfigured()).toBe(false);
    expect(new TelegramChannel({ chatId: "1" }).isConfigured()).toBe(false);
    expect(new TelegramChannel({ token: "  ", chatId: "1" }).isConfigured()).toBe(false);
    expect(TelegramChannel.fromEnv({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CEO_CHAT_ID: "1" }).isConfigured()).toBe(true);
    await expect(new TelegramChannel({}).send(msg)).rejects.toMatchObject({ retryable: true });
  });

  it("classifica erros: 429/5xx/rede são repetíveis; 400/401/403 (chat errado, bot bloqueado) não", async () => {
    const run = (r: Response | Error) => {
      const fetchImpl = vi.fn()[r instanceof Error ? "mockRejectedValue" : "mockResolvedValue"](r);
      return new TelegramChannel({ token: "123:ABC", chatId: "1", fetchImpl }).send(msg).catch((e) => e as NotificationError);
    };
    expect(await run(err(429, "Too Many Requests"))).toMatchObject({ retryable: true });
    expect(await run(err(502, "Bad Gateway"))).toMatchObject({ retryable: true });
    expect(await run(new TypeError("fetch failed"))).toMatchObject({ retryable: true });
    expect(await run(err(403, "Forbidden: bot was blocked by the user"))).toMatchObject({ retryable: false });
    expect(await run(err(400, "Bad Request: chat not found"))).toMatchObject({ retryable: false });
    expect(await run(err(401, "Unauthorized"))).toMatchObject({ retryable: false });
  });

  it("o token nunca aparece em mensagem de erro", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("getaddrinfo ENOTFOUND api.telegram.org/bot123:SECRET/sendMessage"));
    const e = (await new TelegramChannel({ token: "123:SECRET", chatId: "1", fetchImpl }).send(msg).catch((x) => x)) as Error;
    expect(e.message).not.toContain("123:SECRET");
    expect(e.message).toContain("***");
  });
});

// ------------------------------------------------------------------------------------------
describe("serviço de notificações (fila → canal)", () => {
  const row = (over: Partial<OutboxRow> = {}): OutboxRow => ({
    id: "n1", event_type: "OUT_OF_STOCK", entity_type: "item", entity_id: "i1", channel: "telegram",
    dedupe_key: "k", payload: { name: "iPhone" }, status: "sending", attempts: 1, max_attempts: 8,
    next_attempt_at: OCCURRED, last_error: null, sent_at: null, created_at: OCCURRED, ...over,
  });

  function setup(rows: OutboxRow[], channel: Partial<NotificationChannel> = {}) {
    const calls = { sent: [] as string[], failed: [] as { id: string; error: string; retryable: boolean }[] };
    const store: OutboxStore = {
      claim: vi.fn().mockResolvedValue(rows),
      markSent: vi.fn(async (id) => void calls.sent.push(id)),
      markFailed: vi.fn(async (id, error, retryable) => void calls.failed.push({ id, error, retryable })),
    };
    const ch: NotificationChannel = { name: "telegram", isConfigured: () => true, send: vi.fn().mockResolvedValue(undefined), ...channel };
    const service = new NotificationService(store, { telegram: ch }, { error: () => {} });
    return { service, store, ch, calls };
  }

  it("envia e marca como enviada", async () => {
    const { service, ch, calls } = setup([row()]);
    const r = await service.processPending();
    expect(r).toEqual({ claimed: 1, sent: 1, retrying: 0, failed: 0 });
    expect((ch.send as ReturnType<typeof vi.fn>).mock.calls[0][0].text).toContain("PRODUTO ESGOTADO");
    expect(calls.sent).toEqual(["n1"]);
  });

  it("Telegram fora do ar: NÃO perde nada — marca falha repetível e segue o lote", async () => {
    const send = vi.fn().mockRejectedValueOnce(new NotificationError("Telegram respondeu 502", true)).mockResolvedValue(undefined);
    const { service, calls } = setup([row({ id: "a" }), row({ id: "b" })], { send });
    const r = await service.processPending();
    expect(r).toMatchObject({ claimed: 2, sent: 1, retrying: 1, failed: 0 });
    expect(calls.failed).toEqual([{ id: "a", error: "Telegram respondeu 502", retryable: true }]);
    expect(calls.sent).toEqual(["b"]);
  });

  it("erro permanente (chat inválido) vai direto para failed; esgotar tentativas também", async () => {
    const permanent = setup([row()], { send: vi.fn().mockRejectedValue(new NotificationError("chat not found", false)) });
    expect(await permanent.service.processPending()).toMatchObject({ failed: 1, retrying: 0 });
    expect(permanent.calls.failed[0].retryable).toBe(false);

    const exhausted = setup([row({ attempts: 8, max_attempts: 8 })], { send: vi.fn().mockRejectedValue(new NotificationError("timeout", true)) });
    expect(await exhausted.service.processPending()).toMatchObject({ failed: 1, retrying: 0 });
  });

  it("canal sem configuração: não reivindica nada, fila fica pendente e sem gastar tentativa", async () => {
    const { service, store } = setup([row()], { isConfigured: () => false });
    const r = await service.processPending();
    expect(r).toMatchObject({ claimed: 0, notConfigured: true });
    expect(store.claim).not.toHaveBeenCalled();
  });

  it("payload quebrado não trava a fila: falha permanente só dele", async () => {
    const bad = row({ id: "bad", event_type: "SALE_COMPLETED", payload: {} });
    const good = row({ id: "good" });
    const { service, calls } = setup([bad, good]);
    const r = await service.processPending();
    expect(r).toMatchObject({ claimed: 2, sent: 1, failed: 1 });
    expect(calls.failed[0]).toMatchObject({ id: "bad", retryable: false });
    expect(calls.sent).toEqual(["good"]);
  });

  it("canal desconhecido na linha falha sem repetir", async () => {
    const { service, calls } = setup([row({ channel: "whatsapp" })]);
    expect(await service.processPending()).toMatchObject({ failed: 1 });
    expect(calls.failed[0].retryable).toBe(false);
  });
});
