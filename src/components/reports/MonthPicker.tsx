"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** Troca o mês mantendo os outros filtros da URL (ex.: fornecedor). */
export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <input
      type="month"
      aria-label="Mês"
      className="input w-auto"
      value={month}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("month", e.target.value);
        router.push(`${pathname}?${next.toString()}`);
      }}
    />
  );
}
