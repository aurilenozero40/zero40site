"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Undo2 } from "lucide-react";
import { cancelSaleAction, returnSaleItemsAction } from "@/app/(app)/vendas/actions";
import { Modal } from "@/components/ui/modal";
import { formatCurrency, formatQuantity } from "@/lib/utils";
import { uuid } from "@/lib/uuid";
import type { SaleStatus } from "@/lib/types";

interface ReturnableItem {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  returned: number;
  trackSerial: boolean;
  /** números de série ainda vendidos (não devolvidos) desse item nesta venda */
  soldSerials: string[];
}

/** Cancelar venda e registrar devolução (só aparece para gerente+; o banco confere de novo). */
export function SaleActions({
  saleId,
  code,
  status,
  total,
  items,
}: {
  saleId: string;
  code: string;
  status: SaleStatus;
  total: number;
  items: ReturnableItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"cancel" | "return" | null>(null);
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [selectedSerials, setSelectedSerials] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const returnKey = useRef({ signature: "", key: "" });

  const canCancel = status === "concluida";
  const canReturn = status === "concluida" || status === "parcialmente_devolvida";
  if (!canCancel && !canReturn) return null;

  const close = () => {
    if (pending) return;
    setMode(null);
    setReason("");
    setQty({});
    setSelectedSerials({});
    setError(null);
  };

  function toggleSerial(itemId: string, serial: string) {
    setSelectedSerials((prev) => {
      const current = prev[itemId] ?? [];
      const next = current.includes(serial) ? current.filter((s) => s !== serial) : [...current, serial];
      return { ...prev, [itemId]: next };
    });
  }

  function submitCancel() {
    setError(null);
    startTransition(async () => {
      const r = await cancelSaleAction({ saleId, reason });
      if (!r.ok) return setError(r.error);
      setMode(null);
      setReason("");
      router.refresh();
    });
  }

  function submitReturn() {
    setError(null);
    const lines = items
      .map((i) =>
        i.trackSerial
          ? { saleItemId: i.id, quantity: (selectedSerials[i.id] ?? []).length, serials: selectedSerials[i.id] }
          : { saleItemId: i.id, quantity: Number((qty[i.id] ?? "0").replace(",", ".")) || 0 }
      )
      .filter((l) => l.quantity > 0);
    // mesma devolução repetida (retry) reaproveita a chave; mudou o conteúdo, chave nova
    const signature = JSON.stringify({ lines, reason });
    if (returnKey.current.signature !== signature) returnKey.current = { signature, key: uuid() };
    const idempotencyKey = returnKey.current.key;

    startTransition(async () => {
      const r = await returnSaleItemsAction({ saleId, idempotencyKey, reason, items: lines });
      if (!r.ok) return setError(r.error);
      setMode(null);
      setReason("");
      setQty({});
      setSelectedSerials({});
      router.refresh();
    });
  }

  const returnLines = items.filter((i) => i.quantity - i.returned > 0);
  const hasSomethingToReturn = returnLines.some((i) =>
    i.trackSerial ? (selectedSerials[i.id] ?? []).length > 0 : Number((qty[i.id] ?? "0").replace(",", ".")) > 0
  );

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canReturn && (
          <button type="button" className="btn-secondary" onClick={() => setMode("return")}>
            <Undo2 size={15} /> Registrar devolução
          </button>
        )}
        {canCancel && (
          <button type="button" className="btn-secondary text-danger hover:border-danger/50" onClick={() => setMode("cancel")}>
            <Ban size={15} /> Cancelar venda
          </button>
        )}
      </div>

      <Modal
        open={mode === "cancel"}
        onOpenChange={(o) => !o && close()}
        title={`Cancelar venda #${code}`}
        description={`Os produtos voltam ao estoque e o CEO é avisado. A venda (${formatCurrency(total)}) continua no histórico como cancelada.`}
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="cancel_reason">
              Motivo do cancelamento *
            </label>
            <textarea id="cancel_reason" rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: cliente desistiu da compra" autoFocus />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
              Voltar
            </button>
            <button type="button" className="btn-primary" onClick={submitCancel} disabled={pending || reason.trim().length < 3}>
              {pending ? "Cancelando..." : "Confirmar cancelamento"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={mode === "return"}
        onOpenChange={(o) => !o && close()}
        title={`Devolução da venda #${code}`}
        description="Informe quanto de cada produto voltou. A quantidade devolvida volta ao estoque."
      >
        <div className="flex flex-col gap-3">
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {returnLines.map((i) =>
              i.trackSerial ? (
                <li key={i.id} className="flex flex-col gap-1.5 px-3 py-2">
                  <p className="truncate text-sm font-medium text-foreground">{i.name}</p>
                  {i.soldSerials.length === 0 ? (
                    <p className="text-xs text-muted">Nenhum número de série disponível para devolver.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-1.5">
                      {i.soldSerials.map((s) => {
                        const checked = (selectedSerials[i.id] ?? []).includes(s);
                        return (
                          <li key={s}>
                            <button
                              type="button"
                              onClick={() => toggleSerial(i.id, s)}
                              className={`rounded-full border px-2.5 py-1 font-mono text-xs ${
                                checked ? "border-accent bg-accent/15 text-foreground" : "border-border text-muted hover:text-foreground"
                              }`}
                            >
                              {s}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ) : (
                <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{i.name}</p>
                    <p className="text-xs text-muted">Pode devolver até {formatQuantity(i.quantity - i.returned, i.unit)}</p>
                  </div>
                  <input
                    inputMode="decimal"
                    aria-label={`Quantidade a devolver de ${i.name}`}
                    className="input h-8 w-20 px-2 text-center"
                    placeholder="0"
                    value={qty[i.id] ?? ""}
                    onChange={(e) => setQty((q) => ({ ...q, [i.id]: e.target.value }))}
                  />
                </li>
              )
            )}
          </ul>
          <div>
            <label className="label" htmlFor="return_reason">
              Motivo da devolução *
            </label>
            <textarea id="return_reason" rows={2} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: produto com defeito" />
          </div>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={close} disabled={pending}>
              Voltar
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={submitReturn}
              disabled={pending || reason.trim().length < 3 || !hasSomethingToReturn}
            >
              {pending ? "Registrando..." : "Confirmar devolução"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
