/**
 * A API do Supabase devolve no máximo ~1000 linhas por consulta e NÃO avisa quando corta.
 * Relatórios que somam no servidor precisam buscar em páginas. `cap` protege contra consulta gigante.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  { pageSize = 1000, cap = 20_000 }: { pageSize?: number; cap?: number } = {}
): Promise<{ rows: T[]; truncated: boolean; error: string | null }> {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { rows, truncated: false, error: error.message };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return { rows, truncated: false, error: null };
  }
  return { rows, truncated: true, error: null };
}
