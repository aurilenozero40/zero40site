import {
  ArrowLeftRight,
  Contact,
  FileBarChart,
  LayoutDashboard,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Users,
  type LucideIcon,
} from "lucide-react";
import { roleRank } from "./roles";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** papel mínimo (ranking de roles.ts): 1 vendedor · 3 gerente · 4 admin/ceo */
  minRank: number;
  /** destaque (ação principal do vendedor) */
  primary?: boolean;
  /** caminhos que NÃO contam como "ativo" para este item (ex.: /vendas/nova é outro item) */
  exclude?: string[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/vendas/nova", label: "Nova venda", icon: ShoppingCart, minRank: 1, primary: true },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, minRank: 1 },
  { href: "/vendas", label: "Vendas", icon: Receipt, minRank: 1, exclude: ["/vendas/nova"] },
  { href: "/clientes", label: "Clientes", icon: Contact, minRank: 1 },
  { href: "/itens", label: "Produtos", icon: Package, minRank: 1 },
  { href: "/movimentacoes", label: "Estoque", icon: ArrowLeftRight, minRank: 3 },
  { href: "/relatorios/entradas", label: "Relatórios", icon: FileBarChart, minRank: 3 },
  { href: "/funcionarios", label: "Funcionários", icon: Users, minRank: 4 },
  { href: "/configuracoes", label: "Configurações", icon: Settings, minRank: 4 },
];

/** Itens que o perfil enxerga no menu. */
export const navFor = (role: string | null | undefined) => NAV_ITEMS.filter((n) => roleRank(role) >= n.minRank);

export function isNavActive(item: NavItem, pathname: string) {
  if (item.exclude?.some((p) => pathname === p || pathname.startsWith(p + "/"))) return false;
  const base = item.href.startsWith("/relatorios") ? "/relatorios" : item.href;
  return pathname === base || pathname.startsWith(base + "/");
}
