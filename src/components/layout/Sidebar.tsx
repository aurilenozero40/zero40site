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
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-foreground text-background md:flex">
      <div className="px-5 py-6">
        <Logo size="sm" />
        <p className="mt-1 text-xs text-background/60">Controle de Estoque</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {navLinks.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-gradient-to-r from-accent to-accent-alt text-accent-foreground"
                  : "text-background/70 hover:bg-background/10 hover:text-background"
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
        {isAdmin && (
          <Link
            href="/funcionarios"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname.startsWith("/funcionarios")
                ? "bg-gradient-to-r from-accent to-accent-alt text-accent-foreground"
                : "text-background/70 hover:bg-background/10 hover:text-background"
            )}
          >
            <Users size={16} />
            Funcionários
          </Link>
        )}
      </nav>
    </aside>
  );
}
