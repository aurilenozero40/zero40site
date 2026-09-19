"use client";

import { useEffect, useRef, useState } from "react";
import { Search, UserPlus, UserRound, X } from "lucide-react";
import { createCustomerQuickAction, searchCustomersAction, type CustomerHit } from "@/app/(app)/vendas/actions";
import { Modal } from "@/components/ui/modal";
import { formatDocument, formatPhone } from "@/lib/documents";

/** Escolhe um cliente existente ou cadastra um novo sem sair da venda. Cliente é opcional. */
export function CustomerPicker({
  value,
  onChange,
}: {
  value: CustomerHit | null;
  onChange: (customer: CustomerHit | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; hits: CustomerHit[] }>({ q: "", hits: [] });
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const hits = await searchCustomersAction(q);
      if (mine === seq.current) setFound({ q, hits });
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // só mostra o resultado da busca que corresponde ao texto atual (nada de resultado velho)
  const results = found.q === query.trim() ? found.hits : [];

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <UserRound size={16} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{value.name}</p>
            <p className="truncate text-xs text-muted">
              {[value.document ? formatDocument(value.document) : null, value.phone ? formatPhone(value.phone) : null].filter(Boolean).join(" · ") || "Sem documento/telefone"}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => onChange(null)} className="rounded p-1 text-muted hover:bg-surface hover:text-foreground" aria-label="Remover cliente">
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            className="input pl-9"
            placeholder="Cliente (nome, CPF ou telefone) — opcional"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
          />
        </div>
        <button type="button" className="btn-secondary px-3" onClick={() => setCreating(true)} title="Cadastrar novo cliente">
          <UserPlus size={16} />
        </button>
      </div>

      {open && query.trim().length >= 2 && (
        <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">Nenhum cliente encontrado.</li>
          ) : (
            results.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-background"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(c);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <span className="text-sm font-medium text-foreground">{c.name}</span>
                  <span className="text-xs text-muted">{[c.document ? formatDocument(c.document) : null, c.phone ? formatPhone(c.phone) : null].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      <NewCustomerModal
        open={creating}
        initialName={query}
        onOpenChange={setCreating}
        onCreated={(c) => {
          onChange(c);
          setQuery("");
          setCreating(false);
        }}
      />
    </div>
  );
}

function NewCustomerModal({
  open,
  initialName,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  initialName: string;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: CustomerHit) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const result = await createCustomerQuickAction({
      name: fd.get("name"),
      document: fd.get("document") ?? "",
      phone: fd.get("phone") ?? "",
      whatsapp: "",
      email: "",
    });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    onCreated(result.data);
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Novo cliente" description="Só o essencial — o cadastro completo fica em Clientes.">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <label className="label" htmlFor="qc_name">
            Nome *
          </label>
          <input id="qc_name" name="name" required className="input" defaultValue={initialName} autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="qc_doc">
              CPF / CNPJ
            </label>
            <input id="qc_doc" name="document" inputMode="numeric" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="qc_phone">
              Telefone / WhatsApp
            </label>
            <input id="qc_phone" name="phone" inputMode="tel" className="input" placeholder="(85) 99999-0000" />
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? "Salvando..." : "Cadastrar e usar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
