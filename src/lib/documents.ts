/** Só os dígitos. */
export const onlyDigits = (value: string) => value.replace(/\D/g, "");

const allSame = (digits: string) => /^(\d)\1+$/.test(digits);

/** CPF válido (11 dígitos, dígitos verificadores corretos, não repetido). */
export function isValidCpf(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 11 || allSame(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const check = ((sum * 10) % 11) % 10;
    if (check !== Number(d[len])) return false;
  }
  return true;
}

/** CNPJ válido (14 dígitos, dígitos verificadores corretos, não repetido). */
export function isValidCnpj(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 14 || allSame(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + Number(d[i]) * w, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export const isValidDocument = (input: string) => {
  const d = onlyDigits(input);
  return d.length === 11 ? isValidCpf(d) : d.length === 14 ? isValidCnpj(d) : false;
};

export function formatDocument(value: string | null | undefined): string {
  const d = onlyDigits(value ?? "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return value ?? "";
}

export function formatPhone(value: string | null | undefined): string {
  const d = onlyDigits(value ?? "");
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  return value ?? "";
}
