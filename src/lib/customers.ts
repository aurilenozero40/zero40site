/**
 * Detecção de cliente duplicado ao cadastrar: mesmo nome, ou telefone igual / diferente em 1 dígito
 * (digitação errada: ...98809-3606 x ...99809-3606). Só AVISA — duas pessoas podem dividir um telefone.
 */
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();

/** Mesmo tamanho e no máximo 1 dígito diferente (ou igual). */
export function phonesSimilar(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = digits(a);
  const y = digits(b);
  if (x.length < 8 || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i] && ++diff > 1) return false;
  return true;
}

export interface CustomerLite {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
}

export function findDuplicateCustomers(input: { name: string; phone?: string | null; whatsapp?: string | null }, existing: CustomerLite[]): CustomerLite[] {
  const name = fold(input.name);
  return existing.filter((c) => {
    if (name && fold(c.name) === name) return true;
    const phones = [input.phone, input.whatsapp].filter(Boolean);
    return phones.some((p) => phonesSimilar(p, c.phone) || phonesSimilar(p, c.whatsapp));
  });
}
