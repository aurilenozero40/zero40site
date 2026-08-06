"use client";

import { useRouter, usePathname } from "next/navigation";

export function MonthPicker({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <input
      type="month"
      className="input w-auto"
      value={month}
      onChange={(e) => router.push(`${pathname}?month=${e.target.value}`)}
    />
  );
}
