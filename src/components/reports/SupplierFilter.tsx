"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

/** Filtro por fornecedor (?fornecedor=<id> ou "sem") que preserva o mês escolhido. */
export function SupplierFilter({ suppliers, value }: { suppliers: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <select
      aria-label="Fornecedor"
      className="input w-auto"
      value={value}
      onChange={(e) => {
        const next = new URLSearchParams(searchParams.toString());
        if (e.target.value) next.set("fornecedor", e.target.value);
        else next.delete("fornecedor");
        const qs = next.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname);
      }}
    >
      <option value="">Todos os fornecedores</option>
      <option value="sem">Sem fornecedor (histórico)</option>
      {suppliers.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
