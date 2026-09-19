"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { isNavActive, navFor } from "@/lib/nav";
import { ROLE_LABEL, isRole } from "@/lib/roles";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";

export function TopBar({ fullName, role }: { fullName: string; role: string }) {
  const router = useRouter();
  const pathname = usePathname();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex flex-col border-b border-border bg-background">
      <div className="flex items-center justify-between px-4 py-3 md:px-6">
        <Logo size="sm" className="md:hidden" />
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-alt text-xs font-semibold text-accent-foreground">
              {fullName.trim().charAt(0).toUpperCase()}
            </div>
            <div className="hidden leading-tight sm:block">
              <p className="text-sm text-foreground">{fullName}</p>
              <p className="text-[11px] text-muted">{isRole(role) ? ROLE_LABEL[role] : role}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <LogOut size={16} />
            <span className="hidden sm:inline">Sair</span>
          </button>
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
        {navFor(role).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium",
              item.primary || isNavActive(item, pathname)
                ? "bg-gradient-to-r from-accent to-accent-alt text-accent-foreground"
                : "bg-surface text-muted"
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
