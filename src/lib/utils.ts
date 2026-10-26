import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { STORE_TZ } from "./dates";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDate(value: string | Date, withTime = false) {
  const date = typeof value === "string" ? new Date(value) : value;
  // sempre no fuso da loja: o servidor roda em UTC e venda das 22h cairia no dia seguinte
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: STORE_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

/** Escapa % _ \ para usar texto do usuário dentro de um ILIKE sem virar curinga. */
export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function formatQuantity(value: number, unit?: string | null) {
  const formatted = new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(value);
  return unit ? `${formatted} ${unit}` : formatted;
}
