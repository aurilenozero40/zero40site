"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isNavActive, navFor } from "@/lib/nav";
import { Logo } from "./Logo";

export function Sidebar({ role }: { role: string }) {
  const pathname = usePathname();
  const items = navFor(role);

  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="border-b border-sidebar-foreground/10 px-5 py-6">
        <Logo size="sm" />
        <p className="mt-1 text-xs text-sidebar-foreground/60">Controle de Estoque</p>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {items.map((item) => {
          const active = isNavActive(item, pathname);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                item.primary
                  ? "mb-2 justify-center bg-gradient-to-r from-accent to-accent-alt py-2.5 text-accent-foreground shadow-sm shadow-accent/30 hover:opacity-90"
                  : active
                    ? "bg-gradient-to-r from-accent/25 to-accent-alt/25 text-sidebar-foreground"
                    : "text-sidebar-foreground/65 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground"
              )}
            >
              {!item.primary && active && (
                <span className="absolute left-0 top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-gradient-to-b from-accent to-accent-alt" />
              )}
              <Icon size={16} />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
