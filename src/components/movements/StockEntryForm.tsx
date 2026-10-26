"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Package, ScanBarcode, Trash2, X } from "lucide-react";
import { checkSerialAction, createStockEntryAction, createSupplierQuickAction, type SupplierHit } from "@/app/(app)/movimentacoes/actions";
import { createItemQuickAction } from "@/app/(app)/itens/actions";
import { findItemByCode, normalizeCode, sameCode } from "@/lib/barcode";
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
  qtyText: string;
  serials: string[];
  unitValueText: string;
}

interface NewItemDraft {
  name: string;
  sku: string;
  barcode: string;
  salePrice: string;
  trackSerial: boolean;
}

const EMPTY_DRAFT: NewItemDraft = { name: "", sku: "", barcode: "", salePrice: "", trackSerial: false };

const parseNumber = (text: string) => {
  const n = Number(text.replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};

const lineQty = (l: EntryLine) => (l.trackSerial ? l.serials.length : parseNumber(l.qtyText));

/** Preenche o custo unitário com o último custo conhecido do produto — o usuário ainda pode corrigir. */
const defaultUnitValueText = (item: Item) => (item.cost_price != null ? item.cost_price.toFixed(2).replace(".", ",") : "");

/**
 * Entrada de estoque: uma NOTA com vários produtos. O fornecedor é da nota — perguntado uma única
 * vez, no primeiro item — e vale para todos os itens. Bipar o mesmo produto de novo soma na linha.
 * Fornecedor e chave de idempotência voltam ao estado inicial ao limpar, registrar ou esvaziar a nota.
 */
export function StockEntryForm({ items, suppliers }: { items: Item[]; suppliers: SupplierHit[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [localItems, setLocalItems] = useState(items);
  const [localSuppliers, setLocalSuppliers] = useState(suppliers);
  const [subtype, setSubtype] = useState("compra");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EntryLine[]>([]);
  const [noteSupplierId, setNoteSupplierId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState<{ kind: "error" | "info" | "ok"; text: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [barcodeInput, setBarcodeInput] = useState("");
  const barcodeRef = useRef<HTMLInputElement>(null);

  // Sugestões ("você quis dizer…?") quando o texto não é um código exato.
  const [suggestions, setSuggestions] = useState<{ text: string; items: Item[] } | null>(null);

  // Primeiro item da nota esperando o fornecedor ser escolhido.
  const [pendingSupplierItem, setPendingSupplierItem] = useState<Item | null>(null);
  const [supplierDraftId, setSupplierDraftId] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState("");
  const [supplierPending, setSupplierPending] = useState(false);
  const supplierRef = useRef<HTMLSelectElement>(null);

  // Código que ainda não existe no catálogo: cadastra ali mesmo, sem trocar de tela.
  const [pendingNewItem, setPendingNewItem] = useState(false);
  const [newItemDraft, setNewItemDraft] = useState<NewItemDraft>(EMPTY_DRAFT);
  const [newItemPending, setNewItemPending] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);
  const newItemNameRef = useRef<HTMLInputElement>(null);

  const [pendingSerial, setPendingSerial] = useState<Item | null>(null);
  const [serialInput, setSerialInput] = useState("");
  const [serialError, setSerialError] = useState<string | null>(null);
  const [expectedQtyText, setExpectedQtyText] = useState("");
  const [serialChecking, setSerialChecking] = useState(false);
  const serialRef = useRef<HTMLInputElement>(null);

  const needsSupplier = subtype === "compra";
  const noteSupplierName = localSuppliers.find((s) => s.id === noteSupplierId)?.name ?? "";
  const busy = !!pendingSupplierItem || !!pendingSerial || pendingNewItem;

  useEffect(() => {
    if (pendingSerial) serialRef.current?.focus();
  }, [pendingSerial]);
  useEffect(() => {
    if (pendingSupplierItem) supplierRef.current?.focus();
  }, [pendingSupplierItem]);
  useEffect(() => {
    if (pendingNewItem) newItemNameRef.current?.focus();
  }, [pendingNewItem]);
  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const t = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  const focusScanner = () => setTimeout(() => barcodeRef.current?.focus(), 0);

  /** Volta a nota INTEIRA ao estado inicial: itens, painel de série, fornecedor, motivo, observação e chave. */
  function resetNote() {
    setLines([]);
    setNoteSupplierId("");
    setSubtype("compra");
    setReason("");
    setSubmitError(null);
    setSuggestions(null);
    setBarcodeInput("");
    setNotice(null);
    setPendingSerial(null);
    setSerialInput("");
    setSerialError(null);
    setExpectedQtyText("");
    setPendingSupplierItem(null);
    setSupplierDraftId("");
    setAddingSupplier(false);
    setNewSupplierName("");
    setPendingNewItem(false);
    setNewItemError(null);
    setIdempotencyKey(crypto.randomUUID());
  }

  function addOrIncrement(item: Item) {
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qtyText: String(parseNumber(next[idx].qtyText) + 1) };
        return next;
      }
      return [...prev, { itemId: item.id, name: item.name, unit: item.unit, trackSerial: false, qtyText: "1", serials: [], unitValueText: defaultUnitValueText(item) }];
    });
    setNotice({ kind: "ok", text: `${item.name} adicionado.` });
    focusScanner();
  }

  function proceedWithItem(item: Item) {
    if (item.track_serial) {
      setPendingSerial(item);
      setSerialInput("");
      setSerialError(null);
      setExpectedQtyText("");
    } else {
      addOrIncrement(item);
    }
  }

  function handleFoundItem(item: Item) {
    setSuggestions(null);
    // Só o PRIMEIRO item da nota dispara a pergunta — e só em compra (os demais motivos não exigem fornecedor).
    if (lines.length === 0 && needsSupplier && !noteSupplierId) {
      setPendingSupplierItem(item);
      setSupplierDraftId("");
      return;
    }
    proceedWithItem(item);
  }

  function handleScan() {
    const code = normalizeCode(barcodeInput);
    if (!code) return;
    const match = findItemByCode(localItems, code);

    if (match.kind === "exact") {
      setBarcodeInput("");
      return handleFoundItem(match.item);
    }
    if (match.kind === "similar") {
      // mesmo código com/sem zero à esquerda: confirma antes de usar
      setSuggestions({ text: code, items: [match.item] });
      return;
    }
    if (match.kind === "names") {
      setSuggestions({ text: code, items: match.items });
      return;
    }
    // Nada parecido: oferece cadastrar. Texto com espaço é nome; sem espaço é o código (como texto, com zeros).
    const looksLikeName = /\s/.test(code);
    setNewItemDraft({ ...EMPTY_DRAFT, name: looksLikeName ? code : "", barcode: looksLikeName ? "" : code });
    setNewItemError(null);
    setPendingNewItem(true);
  }

  function pickSuggestion(item: Item) {
    setBarcodeInput("");
    setSuggestions(null);
    handleFoundItem(item);
  }

  async function submitNewItem() {
    const name = newItemDraft.name.trim();
    if (!name) return setNewItemError("Informe o nome do produto.");
    if (!newItemDraft.sku.trim()) return setNewItemError("Informe o SKU do produto (obrigatório).");
    setNewItemError(null);
    setNewItemPending(true);
    const r = await createItemQuickAction({
      name,
      sku: newItemDraft.sku || null,
      barcode: newItemDraft.barcode || null,
      salePrice: newItemDraft.salePrice ? Number(newItemDraft.salePrice.replace(",", ".")) : null,
      trackSerial: newItemDraft.trackSerial,
    });
    setNewItemPending(false);
    if (!r.ok) return setNewItemError(r.error);
    setLocalItems((prev) => [...prev, r.data]);
    setPendingNewItem(false);
    setBarcodeInput("");
    setNotice({ kind: "ok", text: `${r.data.name} cadastrado.` });
    handleFoundItem(r.data);
  }

  // Escolher o fornecedor da nota já adiciona o primeiro item — sem clique extra em "Confirmar".
  function chooseSupplier(supplierId: string) {
    if (!pendingSupplierItem || !supplierId) return;
    const item = pendingSupplierItem;
    setNoteSupplierId(supplierId);
    setPendingSupplierItem(null);
    setSupplierDraftId("");
    proceedWithItem(item);
  }

  async function submitNewSupplier() {
    if (!newSupplierName.trim()) return;
    setSupplierPending(true);
    const r = await createSupplierQuickAction(newSupplierName);
    setSupplierPending(false);
    if (r.error || !r.data) return setNotice({ kind: "error", text: r.error ?? "Não foi possível cadastrar o fornecedor." });
    setLocalSuppliers((prev) => [...prev.filter((s) => s.id !== r.data!.id), r.data!].sort((a, b) => a.name.localeCompare(b.name)));
    setAddingSupplier(false);
    setNewSupplierName("");
    if (pendingSupplierItem) chooseSupplier(r.data.id);
    else setNoteSupplierId(r.data.id);
  }

  async function confirmSerialScan() {
    const s = serialInput.trim();
    setSerialError(null);
    if (!s || !pendingSerial || serialChecking) return;
    if (s.length < 4 || /\s/.test(s)) {
      setSerialError("Número de série inválido: use ao menos 4 caracteres, sem espaços.");
      return;
    }
    // erro típico: bipar o produto errado com o painel de série aberto
    if (localItems.some((i) => sameCode(i.barcode, s) || sameCode(i.sku, s))) {
      setSerialError(`"${s}" é o código de um produto, não um número de série. Bipe o número de série da peça.`);
      return;
    }
    if (lines.some((l) => l.serials.some((x) => x.toLowerCase() === s.toLowerCase()))) {
      setSerialError(`${s} já foi bipado nesta entrada.`);
      return;
    }
    setSerialChecking(true);
    const check = await checkSerialAction(s); // já existe no banco?
    setSerialChecking(false);
    if (!check.ok) {
      setSerialError(check.error);
      return;
    }
    const item = pendingSerial;
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.itemId === item.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], serials: [...next[idx].serials, s] };
        return next;
      }
      return [...prev, { itemId: item.id, name: item.name, unit: item.unit, trackSerial: true, qtyText: "", serials: [s], unitValueText: defaultUnitValueText(item) }];
    });
    setSerialInput("");
  }

  const serialCount = pendingSerial ? (lines.find((l) => l.itemId === pendingSerial.id)?.serials.length ?? 0) : 0;
  const expectedSerials = expectedQtyText.trim() === "" ? null : Number(expectedQtyText.replace(",", "."));
  const serialMismatch = expectedSerials !== null && (!Number.isInteger(expectedSerials) || expectedSerials !== serialCount);
  const canFinishSerial = serialCount > 0 && !serialMismatch;

  /** Só conclui com ao menos 1 serial e, se a quantidade foi informada, com exatamente essa quantidade. */
  function finishSerialEntry() {
    if (!canFinishSerial) {
      setSerialError(
        serialCount === 0
          ? "Bipe ao menos um número de série antes de concluir."
          : `Você informou ${expectedQtyText} unidade(s), mas bipou ${serialCount}.`
      );
      return;
    }
    setPendingSerial(null);
    setSerialInput("");
    setSerialError(null);
    setExpectedQtyText("");
    focusScanner();
  }

  /** Fecha o painel sem exigir nada (o que já foi bipado continua na nota). */
  function cancelSerialEntry() {
    setPendingSerial(null);
    setSerialInput("");
    setSerialError(null);
    setExpectedQtyText("");
    focusScanner();
  }

  /** Aplica a mudança nas linhas; se a nota ficou vazia, volta ao estado inicial (pergunta o fornecedor de novo). */
  function updateLines(fn: (prev: EntryLine[]) => EntryLine[]) {
    const next = fn(lines);
    if (next.length === 0) {
      resetNote();
      return;
    }
    setLines(next);
  }

  const removeLine = (itemId: string) => updateLines((prev) => prev.filter((l) => l.itemId !== itemId));
  const removeSerialFromLine = (itemId: string, serial: string) =>
    updateLines((prev) =>
      prev.flatMap((l) => {
        if (l.itemId !== itemId) return [l];
        const nextSerials = l.serials.filter((s) => s !== serial);
        return nextSerials.length === 0 ? [] : [{ ...l, serials: nextSerials }];
      })
    );

  const blocking: string[] = [];
  if (lines.length > 0 && needsSupplier && !noteSupplierId) blocking.push("Informe o fornecedor da nota.");
  for (const l of lines) {
    if (lineQty(l) <= 0) blocking.push(`Quantidade inválida: ${l.name}`);
    if (needsSupplier && parseNumber(l.unitValueText) <= 0) blocking.push(`Informe o custo unitário de ${l.name} (obrigatório em compra).`);
  }
  const canSubmit = lines.length > 0 && blocking.length === 0 && !busy;

  function submit() {
    if (pending || !canSubmit) return; // clique duplo: o botão já está travado e o servidor ainda confere a chave
    setSubmitError(null);
    startTransition(async () => {
      const r = await createStockEntryAction({
        subtype,
        reason: reason.trim() || null,
        supplierId: noteSupplierId || null,
        idempotencyKey,
        items: lines.map((l) => ({
          itemId: l.itemId,
          quantity: l.trackSerial ? undefined : parseNumber(l.qtyText),
          unitValue: parseNumber(l.unitValueText) || null,
          serials: l.trackSerial ? l.serials : undefined,
        })),
      });
      if (!r.ok) return setSubmitError(r.error);
      resetNote();
      router.push("/movimentacoes");
    });
  }

  const totalUnits = lines.reduce((s, l) => s + lineQty(l), 0);
  const totalValue = lines.reduce((s, l) => s + lineQty(l) * parseNumber(l.unitValueText), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-2">
        <label htmlFor="stock_entry_barcode" className="label mb-0">
          Código de barras, SKU ou nome
        </label>
        <div className="relative">
          <ScanBarcode size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="stock_entry_barcode"
            ref={barcodeRef}
            autoFocus
            autoComplete="off"
            disabled={busy}
            className="input h-11 pl-10 text-base disabled:opacity-50"
            placeholder="Bipe o código de barras, ou digite o SKU / nome e aperte Enter"
            value={barcodeInput}
            onChange={(e) => {
              setBarcodeInput(e.target.value);
              if (suggestions) setSuggestions(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleScan();
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
        {suggestions && (
          <div className="flex flex-col gap-1.5 rounded-md border border-accent/40 bg-accent/5 p-3">
            <p className="text-sm font-medium text-foreground">
              {suggestions.items.length === 1 ? "Você quis dizer este produto?" : "Esses produtos batem com o que você digitou:"}
            </p>
            <ul className="flex flex-col gap-1">
              {suggestions.items.map((i) => (
                <li key={i.id}>
                  <button type="button" className="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-sm hover:bg-background" onClick={() => pickSuggestion(i)}>
                    <span className="font-medium text-foreground">{i.name}</span>
                    <span className="font-mono text-xs text-muted">{i.sku ?? i.barcode ?? "sem código"}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="self-start text-xs text-muted hover:text-foreground"
              onClick={() => {
                const code = suggestions.text;
                setSuggestions(null);
                const looksLikeName = /\s/.test(code);
                setNewItemDraft({ ...EMPTY_DRAFT, name: looksLikeName ? code : "", barcode: looksLikeName ? "" : code });
                setNewItemError(null);
                setPendingNewItem(true);
              }}
            >
              Nenhum desses — cadastrar produto novo
            </button>
          </div>
        )}
      </div>

      {pendingNewItem && (
        <div className="card flex flex-col gap-3 border-accent/40 bg-accent/5">
          <div>
            <p className="text-sm font-medium text-foreground">Produto novo</p>
            <p className="text-xs text-muted">Nenhum produto com esse código, SKU ou nome. Preencha o essencial aqui — dá pra completar o resto depois em Produtos.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
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
              <label className="label" htmlFor="new_item_barcode">
                Código de barras
              </label>
              <input
                id="new_item_barcode"
                className="input font-mono"
                value={newItemDraft.barcode}
                onChange={(e) => setNewItemDraft((d) => ({ ...d, barcode: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="new_item_sku">
                SKU *
              </label>
              <input id="new_item_sku" className="input font-mono" value={newItemDraft.sku} onChange={(e) => setNewItemDraft((d) => ({ ...d, sku: e.target.value }))} />
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
            <label className="flex items-center gap-2 text-sm text-foreground sm:col-span-3">
              <input type="checkbox" checked={newItemDraft.trackSerial} onChange={(e) => setNewItemDraft((d) => ({ ...d, trackSerial: e.target.checked }))} />
              Esse produto tem número de série (IMEI)
            </label>
          </div>
          {newItemError && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle size={14} /> {newItemError}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={newItemPending || !newItemDraft.name.trim() || !newItemDraft.sku.trim()} onClick={submitNewItem}>
              {newItemPending ? "Cadastrando..." : "Cadastrar e continuar"}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setPendingNewItem(false);
                focusScanner();
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {pendingSupplierItem && (
        <div className="card flex flex-col gap-2 border-accent/40 bg-accent/5">
          <p className="text-sm font-medium text-foreground">De qual fornecedor é esta nota?</p>
          <p className="text-xs text-muted">
            Só perguntamos agora, no primeiro item (<strong>{pendingSupplierItem.name}</strong>) — todos os outros itens desta nota vão com o mesmo fornecedor.
          </p>
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
              <select ref={supplierRef} aria-label="Fornecedor da nota" className="input" value={supplierDraftId} onChange={(e) => chooseSupplier(e.target.value)}>
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
                  setPendingSupplierItem(null);
                  focusScanner();
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
            Números de série de <strong>{pendingSerial.name}</strong>
          </p>
          <div className="flex items-center gap-2 text-xs text-muted">
            <label htmlFor="serial_expected">Quantas unidades? (opcional)</label>
            <input
              id="serial_expected"
              inputMode="numeric"
              className="input h-8 w-20 px-2 text-center"
              value={expectedQtyText}
              onChange={(e) => {
                setExpectedQtyText(e.target.value);
                setSerialError(null);
              }}
            />
            <span>Se informar, só conclui ao bipar exatamente essa quantidade.</span>
          </div>
          <div className="flex gap-2">
            <input
              ref={serialRef}
              autoComplete="off"
              className="input h-11 flex-1 text-base"
              placeholder="Bipe o número de série (não o código de barras do produto) e aperte Enter"
              value={serialInput}
              onChange={(e) => {
                setSerialInput(e.target.value);
                setSerialError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmSerialScan();
                } else if (e.key === "Escape") {
                  cancelSerialEntry();
                }
              }}
            />
            <button type="button" className="btn-primary shrink-0" disabled={!canFinishSerial} onClick={finishSerialEntry}>
              Concluir este item
            </button>
            <button type="button" className="btn-secondary shrink-0" onClick={cancelSerialEntry}>
              Fechar
            </button>
          </div>
          {serialError && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle size={14} /> {serialError}
            </p>
          )}
          {(() => {
            const count = lines.find((l) => l.itemId === pendingSerial.id)?.serials.length ?? 0;
            return count > 0 ? <p className="text-xs text-muted">{count} bipado(s) até agora.</p> : null;
          })()}
        </div>
      )}

      {lines.length > 0 && (
        <div className="card grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="stock_entry_supplier">
              Fornecedor da nota {needsSupplier && "*"}
            </label>
            <select id="stock_entry_supplier" className="input" value={noteSupplierId} onChange={(e) => setNoteSupplierId(e.target.value)}>
              <option value="">{needsSupplier ? "Selecione..." : "Sem fornecedor"}</option>
              {localSuppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">Vale para todos os itens desta nota.</p>
          </div>
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
      )}

      <div className="card overflow-x-auto p-0">
        {lines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-16 text-center text-muted">
            <Package size={28} className="opacity-50" />
            <p className="text-sm">Nenhum item nesta nota ainda.</p>
            <p className="text-xs">Bipe o código de barras (ou digite SKU/nome) do produto para começar.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Quantidade</th>
                <th className="px-4 py-3 text-right">Custo unit. (R$)</th>
                <th className="px-4 py-3 text-right">Valor total</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.itemId} className="border-b border-border last:border-0">
                  <td className="max-w-[220px] px-4 py-3">
                    <p className="truncate font-medium text-foreground">{l.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    {l.trackSerial ? (
                      <div className="flex flex-col gap-1">
                        <span className="tabular-nums text-foreground">{l.serials.length}</span>
                        <ul className="flex flex-wrap gap-1">
                          {l.serials.map((s) => (
                            <li key={s} className="flex items-center gap-1 rounded-full bg-background px-2 py-0.5 font-mono text-[11px] text-muted">
                              {s}
                              <button type="button" onClick={() => removeSerialFromLine(l.itemId, s)} aria-label={`Remover ${s}`} className="hover:text-danger">
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
                        onChange={(e) => setLines((prev) => prev.map((x) => (x.itemId === l.itemId ? { ...x, qtyText: e.target.value } : x)))}
                      />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      inputMode="decimal"
                      aria-label={`Custo unitário de ${l.name}`}
                      placeholder="0,00"
                      className="input h-8 w-24 px-2 text-right"
                      value={l.unitValueText}
                      onChange={(e) => setLines((prev) => prev.map((x) => (x.itemId === l.itemId ? { ...x, unitValueText: e.target.value } : x)))}
                    />
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-foreground">{formatCurrency(lineQty(l) * parseNumber(l.unitValueText))}</td>
                  <td className="px-2 py-3">
                    <button type="button" className="rounded p-1.5 text-muted hover:bg-background hover:text-danger" onClick={() => removeLine(l.itemId)} aria-label={`Remover ${l.name}`}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {lines.length > 0 && (
        <p className="text-xs text-muted">
          Total desta nota: {totalUnits} unidade(s) · {formatCurrency(totalValue)}
          {noteSupplierName && <> · fornecedor {noteSupplierName}</>}
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
          <button
            type="button"
            className="text-xs text-muted hover:text-danger"
            onClick={() => {
              resetNote();
              focusScanner();
            }}
          >
            Limpar nota
          </button>
        )}
      </div>
    </div>
  );
}
