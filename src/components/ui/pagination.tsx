import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Paginação por URL (server-side): mantém os demais filtros da busca. */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) {
    return <p className="text-xs text-muted">{total === 1 ? "1 registro" : `${total} registros`}</p>;
  }

  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v);
    if (p > 1) qs.set("pagina", String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const linkClass = "btn-secondary h-8 px-2 text-xs";
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted">
      <span>
        {from}–{to} de {total}
      </span>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkClass} aria-label="Página anterior">
            <ChevronLeft size={14} /> Anterior
          </Link>
        ) : null}
        <span>
          Página {page} de {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className={linkClass} aria-label="Próxima página">
            Próxima <ChevronRight size={14} />
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/** Lê ?pagina= com segurança (mínimo 1). */
export const parsePage = (value: string | undefined) => Math.max(1, Math.floor(Number(value)) || 1);
