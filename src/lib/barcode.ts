/**
 * Códigos (barras, SKU) são TEXTO. Nunca virar número: "0101336000" tem zero à esquerda que é
 * parte do código. Aqui só tiramos espaços das pontas (leitores às vezes enviam espaço/CR).
 */
export function normalizeCode(raw: string | null | undefined) {
  return (raw ?? "").trim();
}

/** Compara códigos sem diferenciar maiúscula/minúscula (SKU "010112513b" = "010112513B"). */
export function sameCode(a: string | null | undefined, b: string | null | undefined) {
  const x = normalizeCode(a).toLowerCase();
  return x !== "" && x === normalizeCode(b).toLowerCase();
}

/**
 * Leitores de código de barras (USB/Bluetooth) funcionam como um teclado. Alguns entregam o
 * UPC-A de 12 dígitos como EAN-13 (com um 0 na frente). Esta chave serve SÓ para ENCONTRAR um
 * produto já cadastrado com o código "equivalente" — nunca para gravar nem para exibir.
 */
export function looseBarcodeKey(raw: string | null | undefined) {
  const code = normalizeCode(raw);
  return /^\d+$/.test(code) ? code.replace(/^0+/, "") : code.toLowerCase();
}

export interface Searchable {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
}

export type CodeMatch<T> =
  | { kind: "exact"; item: T; by: "barcode" | "sku" }
  | { kind: "similar"; item: T }
  | { kind: "names"; items: T[] }
  | { kind: "none" };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Localiza o produto digitado/bipado: código de barras ou SKU exatos primeiro; depois o mesmo
 * código sem zeros à esquerda (UPC↔EAN); por fim nome (todas as palavras digitadas). Só depois
 * disso o chamador oferece "cadastrar produto novo".
 */
export function findItemByCode<T extends Searchable>(items: T[], input: string, limit = 8): CodeMatch<T> {
  const code = normalizeCode(input);
  if (!code) return { kind: "none" };

  const byBarcode = items.find((i) => sameCode(i.barcode, code));
  if (byBarcode) return { kind: "exact", item: byBarcode, by: "barcode" };
  const bySku = items.find((i) => sameCode(i.sku, code));
  if (bySku) return { kind: "exact", item: bySku, by: "sku" };

  const key = looseBarcodeKey(code);
  const similar = items.find((i) => (i.barcode && looseBarcodeKey(i.barcode) === key) || (i.sku && looseBarcodeKey(i.sku) === key));
  if (similar) return { kind: "similar", item: similar };

  const words = fold(code).split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const named = items.filter((i) => {
      const hay = fold(`${i.name} ${i.sku ?? ""} ${i.barcode ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
    if (named.length > 0) return { kind: "names", items: named.slice(0, limit) };
  }
  return { kind: "none" };
}

/**
 * Valida o dígito verificador de códigos GTIN numéricos (EAN-8, UPC-A/12,
 * EAN-13, GTIN-14). Serve pra pegar erro de digitação — códigos internos
 * (Code 128 alfanumérico etc.) são válidos no sistema, então isso é só um aviso.
 */
export function isValidGtin(code: string) {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;

  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits
    .reverse()
    .reduce((acc, digit, i) => acc + digit * (i % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === check;
}
