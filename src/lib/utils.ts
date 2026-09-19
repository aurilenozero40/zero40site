import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

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
  return new Intl.DateTimeFormat("pt-BR", {
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
