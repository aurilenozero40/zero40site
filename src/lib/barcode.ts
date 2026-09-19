/**
 * Leitores de código de barras (USB/Bluetooth) funcionam como um teclado:
 * "digitam" o código e apertam Enter. Alguns entregam o UPC-A de 12 dígitos
 * como EAN-13 (com um 0 na frente), então comparamos sem zeros à esquerda.
 */
export function normalizeBarcode(raw: string | null | undefined) {
  return (raw ?? "").trim().replace(/^0+/, "");
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
