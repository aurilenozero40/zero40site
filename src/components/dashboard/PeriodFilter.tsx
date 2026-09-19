import Link from "next/link";
import { PERIODS, PERIOD_LABEL, type Period } from "@/lib/dates";
import { cn } from "@/lib/utils";

/** Hoje · Ontem · 7 dias · 30 dias · Mês atual · Período personalizado (tudo por URL, sem JS). */
export function PeriodFilter({ active, from, to }: { active: Period; from?: string; to?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIODS.filter((p) => p !== "custom").map((p) => (
        <Link
          key={p}
          href={`/dashboard?periodo=${p}`}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            active === p ? "border-accent bg-accent/15 text-foreground" : "border-border bg-surface text-muted hover:text-foreground"
          )}
        >
          {PERIOD_LABEL[p]}
        </Link>
      ))}
      <form method="get" className="flex items-center gap-1.5">
        <input type="hidden" name="periodo" value="custom" />
        <input type="date" name="de" defaultValue={from} className="input h-9 w-auto px-2 text-sm" aria-label="De" required />
        <span className="text-sm text-muted">a</span>
        <input type="date" name="ate" defaultValue={to} className="input h-9 w-auto px-2 text-sm" aria-label="Até" required />
        <button type="submit" className={cn("btn-secondary h-9 px-3 text-sm", active === "custom" && "border-accent")}>
          Aplicar
        </button>
      </form>
    </div>
  );
}
