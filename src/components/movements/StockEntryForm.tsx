"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Package, ScanBarcode, Trash2, X } from "lucide-react";
import { createStockEntryAction, createSupplierQuickAction, type SupplierHit } from "@/app/(app)/movimentacoes/actions";
import { createItemQuickAction } from "@/app/(app)/itens/actions";
import { normalizeBarcode } from "@/lib/barcode";
import { cn, formatCurrency } from "@/lib/utils";
import type { Item } from "@/lib/types";

const SUBTYPES = [
  { value: "compra", label: "Compra" },
  { value: "devolucao", label: "Devolução" },
  { value: "transferencia", label: "Transferência" },
  { value: "outros", label: "Outros" },
];

interface EntryLine {
  itemId: string;
  name: string;
  unit: string;
  trackSerial: boolean;
  supplierId: string;
  supplierName: string;
  qtyText: string;
  serials: string[];
  unitValueText: string;
}

interface PendingSupplier {
  item: Item;
}

interface PendingSerial {
  item: Item;
  supplierId: string;
  supplierName: string;
}

interface NewItemDraft {
  name: string;
  sku: string;
  salePrice: string;
  trackSerial: boolean;
}

const parseNumber = (text: string) => {
  const n = Number(text.replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Entrada de estoque: uma NOTA com vários produtos de uma vez. Bipar o mesmo item do mesmo
 * fornecedor de novo só soma na mesma linha (grupo, por quantidade); item diferente, ou o
 * mesmo item com número de série, vira linha própria (individual).
 */
export function StockEntryForm({ items, suppliers }: { items: Item[]; suppliers: SupplierHit[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [localItems, setLocalItems] = useState(items);
  const [subtype, setSubtype] = useState("compra");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [notice, setNotice] = useState<{ kind: "error" | "info" | "ok"; text: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeRef = useRef<HTMLInputElement>(null);

  // Código bipado que ainda não existe no catálogo: cadastra ali mesmo, sem trocar de tela.
  const [pendingNewItem, setPendingNewItem] = useState<string | null>(null); // guarda o código de barras
  const [newItemDraft, setNewItemDraft] = useState<NewItemDraft>({ name: "", sku: "", salePrice: "", trackSerial: false });
  const [newItemPending, setNewItemPending] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);
  const newItemNameRef = useRef<HTMLInputElement>(null);

  const [localSuppliers, setLocalSuppliers] = useState(suppliers);
  const [pendingSupplier, setPendingSupplier] = useState<PendingSupplier | null>(null);
  const [supplierDraftId, setSupplierDraftId] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierPending, setSupplierPending] = useState(false);

  const [pendingSerial, setPendingSerial] = useState<PendingSerial | null>(null);
  const [serialInput, setSerialInput] = useState("");
  const [serialError, setSerialError] = useState<string | null>(null);
  const serialRef = useRef<HTMLInputElement>(null);
  const supplierRef = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (pendingSerial) serialRef.current?.focus();
  }, [pendingSerial]);
  useEffect(() => {
    if (pendingSupplier) supplierRef.current?.focus();
  }, [pendingSupplier]);
  useEffect(() => {
    if (pendingNewItem) newItemNameRef.current?.focus();
  }, [pendingNewItem]);
  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  function addOrIncrement(item: Item, supplierId: string, supplierName: string) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id && l.supplierId === supplierId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qtyText: String(parseNumber(next[idx].qtyText) + 1) };
        return next;
      }
      return [
        ...prev,
        { itemId: item.id, name: item.name, unit: item.unit, trackSerial: false, supplierId, supplierName, qtyText: "1", serials: [], unitValueText: "" },
      ];
    });
    setNotice({ kind: "ok", text: `${item.name} adicionado.` });
  }

  function proceedWithSupplier(item: Item, supplierId: string, supplierName: string) {
    if (item.track_serial) {
      setPendingSerial({ item, supplierId, supplierName });
      setSerialInput("");
      setSerialError(null);
    } else {
      addOrIncrement(item, supplierId, supplierName);
      barcodeRef.current?.focus();
    }
  }

  function handleFoundItem(item: Item) {
    const existingLine = lines.find((l) => l.itemId === item.id);
    const knownId = item.supplier_id ?? existingLine?.supplierId ?? null;
    if (!knownId) {
      setPendingSupplier({ item });
      setSupplierDraftId("");
      return;
    }
    const knownName = localSuppliers.find((s) => s.id === knownId)?.name ?? existingLine?.supplierName ?? "";
    proceedWithSupplier(item, knownId, knownName);
  }

  function handleBarcodeScan() {
    const normalized = normalizeBarcode(barcodeInput);
    if (!normalized) return;
    const found = localItems.find((i) => normalizeBarcode(i.barcode) === normalized);
    setBarcodeInput("");
    if (!found) {
      // Código novo: cadastra o produto ali mesmo em vez de travar o usuário numa tela vazia.
      setPendingNewItem(normalized);
      setNewItemDraft({ name: "", sku: "", salePrice: "", trackSerial: false });
      setNewItemError(null);
      return;
    }
    handleFoundItem(found);
  }

  async function submitNewItem() {
    if (!pendingNewItem) return;
    const name = newItemDraft.name.trim();
    if (!name) return setNewItemError("Informe o nome do produto.");
    setNewItemError(null);
    setNewItemPending(true);
    const r = await createItemQuickAction({
      name,
      sku: newItemDraft.sku || null,
      barcode: pendingNewItem,
      salePrice: newItemDraft.salePrice ? Number(newItemDraft.salePrice.replace(",", ".")) : null,
      trackSerial: newItemDraft.trackSerial,
    });
    setNewItemPending(false);
    if (!r.ok) return setNewItemError(r.error);
    setLocalItems((prev) => [...prev, r.data]);
    setPendingNewItem(null);
    setNotice({ kind: "ok", text: `${r.data.name} cadastrado.` });
    handleFoundItem(r.data);
  }

  // Escolher o fornecedor já avança sozinho — sem precisar de um clique extra em "Confirmar".
  function chooseSupplier(supplierId: string) {
    if (!pendingSupplier || !supplierId) return;
    const name = localSuppliers.find((s) => s.id === supplierId)?.name ?? "";
    const item = pendingSupplier.item;
    setPendingSupplier(null);
    setSupplierDraftId("");
    proceedWithSupplier(item, supplierId, name);
  }

  async function submitNewSupplier() {
    if (!newSupplierName.trim()) return;
    setSupplierPending(true);
    const r = await createSupplierQuickAction(newSupplierName);
    setSupplierPending(false);
    if (r.error || !r.data) return setNotice({ kind: "error", text: r.error ?? "Não foi possível cadastrar o fornecedor." });
    setLocalSuppliers((prev) => [...prev, r.data!].sort((a, b) => a.name.localeCompare(b.name)));
    setAddingSupplier(false);
    setNewSupplierName("");
    chooseSupplier(r.data.id);
  }

  function confirmSerialScan() {
    const s = serialInput.trim();
    setSerialError(null);
    if (!s || !pendingSerial) return;
    if (lines.some((l) => l.serials.includes(s))) {
      setSerialError(`${s} já foi bipado nesta entrada.`);
      return;
    }
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === pendingSerial.item.id && l.supplierId === pendingSerial.supplierId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], serials: [...next[idx].serials, s] };
        return next;
      }
      return [
        ...prev,
        {
          itemId: pendingSerial.item.id,
          name: pendingSerial.item.name,
          unit: pendingSerial.item.unit,
          trackSerial: true,
          supplierId: pendingSerial.supplierId,
          supplierName: pendingSerial.supplierName,
          qtyText: "",
          serials: [s],
          unitValueText: "",
        },
      ];
    });
    setSerialInput("");
  }

  function finishSerialEntry() {
    setPendingSerial(null);
    setSerialInput("");
    setSerialError(null);
    barcodeRef.current?.focus();
  }

  function removeLine(itemId: string, supplierId: string) {
    setLines((prev) => prev.filter((l) => !(l.itemId === itemId && l.supplierId === supplierId)));
  }

  function removeSerialFromLine(itemId: string, supplierId: string, serial: string) {
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.itemId !== itemId || l.supplierId !== supplierId) return [l];
        const nextSerials = l.serials.filter((s) => s !== serial);
        return nextSerials.length === 0 ? [] : [{ ...l, serials: nextSerials }];
      })
    );
  }

  const blocking: string[] = [];
  for (const l of lines) {
    const qty = l.trackSerial ? l.serials.length : parseNumber(l.qtyText);
    if (qty <= 0) blocking.push(`Quantidade inválida: ${l.name}`);
    if (subtype === "compra" && !l.supplierId) blocking.push(`Informe o fornecedor de ${l.name}`);
  }
  const canSubmit = lines.length > 0 && blocking.length === 0 && !pendingSupplier && !pendingSerial;

  function submit() {
    setSubmitError(null);
    startTransition(async () => {
      const r = await createStockEntryAction({
        subtype,
        reason: reason.trim() || null,
        items: lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.trackSerial ? undefined : parseNumber(l.qtyText),
          unitValue: parseNumber(l.unitValueText) || null,
          supplierId: l.supplierId || null,
          serials: l.trackSerial ? l.serials : undefined,
        })),
      });
      if (!r.ok) return setSubmitError(r.error);
      router.push("/movimentacoes");
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-2">
        <label htmlFor="stock_entry_barcode" className="label mb-0">
          Código de barras
        </label>
        <div className="relative">
          <ScanBarcode size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="stock_entry_barcode"
            ref={barcodeRef}
            autoFocus
            autoComplete="off"
            inputMode="numeric"
            disabled={!!pendingSupplier || !!pendingSerial || !!pendingNewItem}
            className="input h-11 pl-10 text-base disabled:opacity-50"
            placeholder="Bipe o código de barras do produto"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleBarcodeScan();
              }
            }}
          />
        </div>
        {notice && (
          <p role="status" className={cn("flex items-center gap-1.5 text-sm font-medium", notice.kind === "error" && "text-danger", notice.kind === "ok" && "text-success")}>
            {notice.kind === "error" ? <AlertTriangle size={14} /> : notice.kind === "ok" ? <CheckCircle2 size={14} /> : null}
            {notice.text}
          </p>
        )}
      </div>

      {pendingNewItem && (
        <div className="card flex flex-col gap-3 border-accent/40 bg-accent/5">
          <div>
            <p className="text-sm font-medium text-foreground">Produto novo — código de barras {pendingNewItem}</p>
            <p className="text-xs text-muted">Esse código ainda não está cadastrado. Preencha o essencial aqui — dá pra completar o resto depois em Produtos.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="new_item_name">
                Nome *
              </label>
              <input
                id="new_item_name"
                ref={newItemNameRef}
                className="input"
                value={newItemDraft.name}
                onChange={(e) => setNewItemDraft((d) => ({ ...d, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewItem();
                  }
                }}
              />
            </div>
            <div>
              <label className="label" htmlFor="new_item_sku">
                SKU
              </label>
              <input
                id="new_item_sku"
                className="input"
                value={newItemDraft.sku}
                onChange={(e) => setNewItemDraft((d) => ({ ...d, sku: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewItem();
                  }
                }}
              />
            </div>
            <div>
              <label className="label" htmlFor="new_item_price">
                Preço de venda (R$)
              </label>
              <input
                id="new_item_price"
                inputMode="decimal"
                className="input"
                placeholder="0,00"
                value={newItemDraft.salePrice}
                onChange={(e) => setNewItemDraft((d) => ({ ...d, salePrice: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewItem();
                  }
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-2">
              <input
                type="checkbox"
                checked={newItemDraft.trackSerial}
                onChange={(e) => setNewItemDraft((d) => ({ ...d, trackSerial: e.target.checked }))}
              />
              Esse produto tem número de série (IMEI)
            </label>
          </div>
          {newItemError && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle size={14} /> {newItemError}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={newItemPending || !newItemDraft.name.trim()} onClick={submitNewItem}>
              {newItemPending ? "Cadastrando..." : "Cadastrar e continuar"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPendingNewItem(null);
                barcodeRef.current?.focus();
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {pendingSupplier && (
        <div className="card flex flex-col gap-2 border-accent/40 bg-accent/5">
          <p className="text-sm font-medium text-foreground">
            De qual fornecedor veio <strong>{pendingSupplier.item.name}</strong>?
          </p>
          <p className="text-xs text-muted">Só perguntamos uma vez — as próximas entradas desse produto já vêm com o fornecedor preenchido.</p>
          {addingSupplier ? (
            <div className="flex gap-2">
              <input
                autoFocus
                className="input"
                placeholder="Nome do fornecedor"
                value={newSupplierName}
                onChange={(e) => setNewSupplierName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submitNewSupplier();
                  }
                }}
              />
              <button type="button" className="btn-secondary shrink-0" onClick={() => setAddingSupplier(false)}>
                Cancelar
              </button>
              <button type="button" className="btn-primary shrink-0" disabled={supplierPending || !newSupplierName.trim()} onClick={submitNewSupplier}>
                {supplierPending ? "..." : "Adicionar"}
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <select
                ref={supplierRef}
                className="input"
                value={supplierDraftId}
                onChange={(e) => chooseSupplier(e.target.value)}
              >
                <option value="">Selecione...</option>
                {localSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button type="button" className="btn-secondary shrink-0" onClick={() => setAddingSupplier(true)}>
                + Novo
              </button>
              <button
                type="button"
                className="shrink-0 text-xs text-muted hover:text-danger"
                onClick={() => {
                  setPendingSupplier(null);
                  barcodeRef.current?.focus();
                }}
              >
                Cancelar
              </button>
            </div>
          )}
        </div>
      )}

      {pendingSerial && (
        <div className="card flex flex-col gap-2 border-accent/40 bg-accent/5">
          <p className="text-sm font-medium text-foreground">
            Números de série de <strong>{pendingSerial.item.name}</strong>{" "}
            <span className="font-normal text-muted">— fornecedor {pendingSerial.supplierName}</span>
          </p>
          <div className="flex gap-2">
            <input
              ref={serialRef}
              autoComplete="off"
              className="input h-11 flex-1 text-base"
              placeholder="Bipe o número de série e aperte Enter"
              value={serialInput}
              onChange={(e) => {
                setSerialInput(e.target.value);
                setSerialError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmSerialScan();
                } else if (e.key === "Escape") {
                  finishSerialEntry();
                }
              }}
            />
            <button type="button" className="btn-primary shrink-0" onClick={finishSerialEntry}>
              Concluir este item
            </button>
          </div>
          {serialError && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle size={14} /> {serialError}
            </p>
          )}
          {(() => {
            const count = lines.find((l) => l.itemId === pendingSerial.item.id && l.supplierId === pendingSerial.supplierId)?.serials.length ?? 0;
            return count > 0 ? <p className="text-xs text-muted">{count} bipado(s) até agora.</p> : null;
          })()}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center text-muted">
            <Package size={28} className="opacity-50" />
            <p className="text-sm">Nenhum item nesta nota ainda.</p>
            <p className="text-xs">Bipe o código de barras do produto para começar.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Fornecedor</th>
                <th className="px-4 py-3">Quantidade</th>
                <th className="px-4 py-3 text-right">Valor unit. (R$)</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={`${l.itemId}:${l.supplierId}`} className="border-b border-border last:border-0">
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate font-medium text-foreground">{l.name}</p>
                  </td>
                  <td className="px-4 py-3 text-muted">{l.supplierName || "—"}</td>
                  <td className="px-4 py-3">
                    {l.trackSerial ? (
                      <div className="flex flex-col gap-1">
                        <span className="tabular-nums text-foreground">{l.serials.length}</span>
                        <ul className="flex flex-wrap gap-1">
                          {l.serials.map((s) => (
                            <li key={s} className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 font-mono text-[11px] text-muted">
                              {s}
                              <button type="button" onClick={() => removeSerialFromLine(l.itemId, l.supplierId, s)} aria-label={`Remover ${s}`} className="hover:text-danger">
                                <X size={10} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <input
                        inputMode="decimal"
                        aria-label={`Quantidade de ${l.name}`}
                        className="input h-8 w-20 px-2 text-center"
                        value={l.qtyText}
                        onChange={(e) =>
                          setLines((prev) => prev.map((x) => (x.itemId === l.itemId && x.supplierId === l.supplierId ? { ...x, qtyText: e.target.value } : x)))
                        }
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      inputMode="decimal"
                      aria-label={`Valor unitário de ${l.name}`}
                      placeholder="0,00"
                      className="input h-8 w-24 px-2 text-right"
                      value={l.unitValueText}
                      onChange={(e) => setLines((prev) => prev.map((x) => (x.itemId === l.itemId && x.supplierId === l.supplierId ? { ...x, unitValueText: e.target.value } : x)))}
                    />
                  </td>
                  <td className="px-2 py-3">
                    <button type="button" className="rounded p-1.5 text-muted hover:bg-background hover:text-danger" onClick={() => removeLine(l.itemId, l.supplierId)} aria-label={`Remover ${l.name}`}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="stock_entry_subtype">
            Motivo da entrada *
          </label>
          <select id="stock_entry_subtype" className="input" value={subtype} onChange={(e) => setSubtype(e.target.value)}>
            {SUBTYPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="stock_entry_reason">
            Observação
          </label>
          <input id="stock_entry_reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex: nota fiscal 12345" />
        </div>
      </div>

      {lines.length > 0 && (
        <p className="text-xs text-muted">
          Total desta nota: {lines.reduce((s, l) => s + (l.trackSerial ? l.serials.length : parseNumber(l.qtyText)), 0)} unidade(s) ·{" "}
          {formatCurrency(lines.reduce((s, l) => s + (l.trackSerial ? l.serials.length : parseNumber(l.qtyText)) * parseNumber(l.unitValueText), 0))}
        </p>
      )}

      {blocking.length > 0 && lines.length > 0 && (
        <ul className="flex flex-col gap-1">
          {blocking.map((b) => (
            <li key={b} className="flex items-start gap-1.5 text-xs font-medium text-danger">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {b}
            </li>
          ))}
        </ul>
      )}
      {submitError && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {submitError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={!canSubmit || pending} onClick={submit}>
          {pending ? "Registrando..." : "Registrar entrada"}
        </button>
        {lines.length > 0 && (
          <button type="button" className="text-xs text-muted hover:text-danger" onClick={() => setLines([])}>
            Limpar nota
          </button>
        )}
      </div>
    </div>
  );
}
