export type ParsedCommand =
  | { kind: "entrada"; sku: string; quantity: number; unitValue: number | null; reason: string | null }
  | { kind: "saida"; sku: string; quantity: number; unitValue: number | null; reason: string | null }
  | { kind: "ajuste"; sku: string; quantity: number; increases: boolean; reason: string }
  | { kind: "saldo"; sku: string }
  | { kind: "ajuda" }
  | { kind: "start" };

export type ParseResult = { ok: true; command: ParsedCommand } | { ok: false; error: string };

export const HELP_TEXT = `Comandos disponíveis:
/entrada <sku> <qtd> <valor_unit> [motivo...]
/saida <sku> <qtd> <valor_unit> [motivo...]
/ajuste <sku> <+qtd|-qtd> <motivo...>
/saldo <sku>
/ajuda

Exemplo: /entrada PARAF-M6 100 0.45 compra fornecedor X`;

function parseNumber(raw: string): number | null {
  const normalized = raw.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseCommand(rawText: string): ParseResult {
  const text = rawText.trim();
  if (!text.startsWith("/")) {
    return { ok: false, error: "Comando não reconhecido. Envie /ajuda para ver os comandos." };
  }

  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase().replace(/^\//, "").split("@")[0];
  const args = parts.slice(1);

  if (command === "ajuda" || command === "help") {
    return { ok: true, command: { kind: "ajuda" } };
  }

  if (command === "start") {
    return { ok: true, command: { kind: "start" } };
  }

  if (command === "saldo") {
    if (args.length < 1) {
      return { ok: false, error: "Uso: /saldo <sku>" };
    }
    return { ok: true, command: { kind: "saldo", sku: args[0] } };
  }

  if (command === "entrada" || command === "saida") {
    if (args.length < 2) {
      return {
        ok: false,
        error: `Uso: /${command} <sku> <qtd> <valor_unit> [motivo...]`,
      };
    }
    const sku = args[0];
    const quantity = parseNumber(args[1]);
    if (quantity === null || quantity <= 0) {
      return { ok: false, error: "Quantidade inválida. Use um número maior que zero." };
    }
    const unitValue = args[2] !== undefined ? parseNumber(args[2]) : null;
    const reasonParts = unitValue !== null ? args.slice(3) : args.slice(2);
    const reason = reasonParts.length > 0 ? reasonParts.join(" ") : null;

    return {
      ok: true,
      command: { kind: command, sku, quantity, unitValue, reason },
    };
  }

  if (command === "ajuste") {
    if (args.length < 3) {
      return { ok: false, error: "Uso: /ajuste <sku> <+qtd|-qtd> <motivo...>" };
    }
    const sku = args[0];
    const signedRaw = args[1];
    const increases = signedRaw.startsWith("+");
    const decreases = signedRaw.startsWith("-");
    if (!increases && !decreases) {
      return { ok: false, error: "Quantidade do ajuste deve começar com + ou - (ex: -1, +5)." };
    }
    const quantity = parseNumber(signedRaw.slice(1));
    if (quantity === null || quantity <= 0) {
      return { ok: false, error: "Quantidade inválida no ajuste." };
    }
    const reason = args.slice(2).join(" ").trim();
    if (!reason) {
      return { ok: false, error: "Motivo é obrigatório para ajuste." };
    }

    return {
      ok: true,
      command: { kind: "ajuste", sku, quantity, increases, reason },
    };
  }

  return { ok: false, error: "Comando não reconhecido. Envie /ajuda para ver os comandos." };
}
