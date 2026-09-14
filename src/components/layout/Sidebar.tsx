"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  FileBarChart,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "./Logo";

export const navLinks = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/itens", label: "Itens", icon: Package },
  { href: "/movimentacoes", label: "Movimentações", icon: ArrowLeftRight },
  { href: "/relatorios/entradas", label: "Relatórios", icon: FileBarChart },
];

export function Sidebar({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="border-b border-sidebar-foreground/10 px-5 py-6">
        <Logo size="sm" />
        <p className="mt-1 text-xs text-sidebar-foreground/60">Controle de Estoque</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {navLinks.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-gradient-to-r from-accent/25 to-accent-alt/25 text-sidebar-foreground"
                  : "text-sidebar-foreground/65 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-accent to-accent-alt" />
              )}
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/funcionarios"
            className={cn(
              "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/funcionarios")
                ? "bg-gradient-to-r from-accent/25 to-accent-alt/25 text-sidebar-foreground"
                : "text-sidebar-foreground/65 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
            )}
          >
            {pathname.startsWith("/funcionarios") && (
              <span className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-accent to-accent-alt" />
            )}
            <Users size={16} />
            Funcionários
          </Link>
        )}
      </nav>
    </aside>
  );
}
