/**
 * Datas no fuso da loja. O servidor (Vercel) roda em UTC: sem isto, "faturamento de hoje"
 * viraria à meia-noite UTC (21h em Brasília) e venda da noite cairia no dia errado.
 */
export const STORE_TZ = "America/Sao_Paulo";

/** Partes de data/hora de `date` no fuso `tz`. */
function partsIn(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Diferença (ms) entre o horário de parede em `tz` e UTC no instante `date`. */
function offsetMs(date: Date, tz: string) {
  const p = partsIn(date, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** Instante UTC em que é 00:00 de (ano, mês, dia) no fuso `tz`. */
export function startOfDayUtc(year: number, month: number, day: number, tz = STORE_TZ): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  return new Date(guess.getTime() - offsetMs(guess, tz));
}

/** Ano/mês/dia de hoje no fuso da loja. */
export function todayParts(now = new Date(), tz = STORE_TZ) {
  const { year, month, day } = partsIn(now, tz);
  return { year, month, day };
}

export interface DateRange {
  from: Date;
  /** exclusivo */
  to: Date;
  label: string;
}

export const PERIODS = ["hoje", "ontem", "7d", "30d", "mes", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "7 dias",
  "30d": "30 dias",
  mes: "Mês atual",
  custom: "Período",
};

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** Converte "2026-09-19" em partes; null se inválido. */
export function parseIsoDate(value: string | undefined | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Intervalo [from, to) de um período, em dias do fuso da loja. */
export function resolvePeriod(period: Period, opts: { now?: Date; from?: string | null; to?: string | null } = {}): DateRange {
  const now = opts.now ?? new Date();
  const t = todayParts(now);
  const today = startOfDayUtc(t.year, t.month, t.day);
  // dias corridos em UTC-3 sem horário de verão; usar o início do dia seguinte via calendário evita depender disso
  const tomorrow = startOfDayUtc(t.year, t.month, t.day + 1);

  switch (period) {
    case "hoje":
      return { from: today, to: tomorrow, label: PERIOD_LABEL.hoje };
    case "ontem":
      return { from: startOfDayUtc(t.year, t.month, t.day - 1), to: today, label: PERIOD_LABEL.ontem };
    case "7d":
      return { from: startOfDayUtc(t.year, t.month, t.day - 6), to: tomorrow, label: "Últimos 7 dias" };
    case "30d":
      return { from: startOfDayUtc(t.year, t.month, t.day - 29), to: tomorrow, label: "Últimos 30 dias" };
    case "mes":
      return { from: startOfDayUtc(t.year, t.month, 1), to: startOfDayUtc(t.year, t.month + 1, 1), label: "Mês atual" };
    case "custom": {
      const a = parseIsoDate(opts.from);
      const b = parseIsoDate(opts.to);
      if (a && b) {
        const from = startOfDayUtc(a.year, a.month, a.day);
        const to = startOfDayUtc(b.year, b.month, b.day + 1);
        if (to > from) return { from, to, label: `${a.day.toString().padStart(2, "0")}/${a.month.toString().padStart(2, "0")} a ${b.day.toString().padStart(2, "0")}/${b.month.toString().padStart(2, "0")}` };
      }
      return resolvePeriod("mes", { now });
    }
  }
}

/** Semana atual (segunda a domingo) no fuso da loja. */
export function currentWeek(now = new Date()): DateRange {
  const t = todayParts(now);
  const weekday = new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay(); // 0 = domingo
  const sinceMonday = (weekday + 6) % 7;
  const from = startOfDayUtc(t.year, t.month, t.day - sinceMonday);
  return { from, to: addDays(from, 7), label: "Semana" };
}

/** "19/09/2026 às 14:32" no fuso da loja. */
export function formatDateTimeBr(value: string | Date, tz = STORE_TZ): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const p = partsIn(d, tz);
  const two = (n: number) => n.toString().padStart(2, "0");
  return `${two(p.day)}/${two(p.month)}/${p.year} às ${two(p.hour)}:${two(p.minute)}`;
}

/** Intervalo do mês "YYYY-MM" (usado nos relatórios de movimentação), no fuso da loja. */
export function monthRange(monthParam: string) {
  const [y, m] = monthParam.split("-").map(Number);
  return { from: startOfDayUtc(y, m, 1), to: startOfDayUtc(y, m + 1, 1) };
}
