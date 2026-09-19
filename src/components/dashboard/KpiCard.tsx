import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "danger" | "warning";
}) {
  return (
    <div className="card card-hover flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p
          className={cn(
            "mt-1.5 truncate text-2xl font-semibold tracking-tight",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
            tone === "warning" && "text-warning",
            (!tone || tone === "default") && "text-foreground"
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
      {Icon && (
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-gradient-to-br from-accent/20 to-accent-alt/20 text-accent">
          <Icon size={19} strokeWidth={2.25} />
        </div>
      )}
    </div>
  );
}
