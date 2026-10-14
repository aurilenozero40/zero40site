"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/relatorios/entradas", label: "Entradas" },
  { href: "/relatorios/saidas", label: "Saídas" },
  { href: "/relatorios/caixa", label: "Caixa" },
  { href: "/relatorios/categorias", label: "Categorias" },
  { href: "/relatorios/reposicao", label: "Reposição" },
  { href: "/relatorios/garantias", label: "Garantias" },
];

export default function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex w-fit flex-wrap gap-1 rounded-md border border-border bg-background p-1">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              pathname === tab.href ? "bg-surface text-foreground" : "text-muted hover:bg-surface hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>
      {children}
    </div>
  );
}
