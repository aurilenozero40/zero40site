import Link from "next/link";

export default function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-md bg-background p-1 w-fit border border-border">
        <Link
          href="/relatorios/entradas"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface hover:text-foreground"
        >
          Entradas
        </Link>
        <Link
          href="/relatorios/saidas"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface hover:text-foreground"
        >
          Saídas
        </Link>
        <Link
          href="/relatorios/caixa"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface hover:text-foreground"
        >
          Caixa
        </Link>
        <Link
          href="/relatorios/categorias"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface hover:text-foreground"
        >
          Categorias
        </Link>
        <Link
          href="/relatorios/reposicao"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface hover:text-foreground"
        >
          Reposição
        </Link>
        <Link
          href="/relatorios/garantias"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface hover:text-foreground"
        >
          Garantias
        </Link>
      </div>
      {children}
    </div>
  );
}
