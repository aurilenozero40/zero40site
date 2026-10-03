"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Minus, Plus, Repeat, ScanBarcode, ShoppingCart, Trash2, X } from "lucide-react";
import {
  createSaleAction,
  searchProductsAction,
  verifySerialAction,
  type CustomerHit,
  type ProductHit,
} from "@/app/(app)/vendas/actions";
import { CustomerPicker } from "@/components/sales/CustomerPicker";
import { Modal } from "@/components/ui/modal";
import { brandLabel, brandsFrom } from "@/lib/sales/brands";
import {
  MAX_INSTALLMENTS,
  PAYMENT_LABEL,
  PAYMENT_METHODS,
  computeCardFee,
  computeSaleTotals,
  discountFromPercent,
  feeKey,
  isCardMethod,
  lineTotalCents,
  maxDiscountCents,
  toCents,
  type PaymentMethod,
} from "@/lib/sales/pricing";
import type { CardFeeRates } from "@/lib/types";
import { cn, formatCurrency, formatQuantity } from "@/lib/utils";
import { uuid } from "@/lib/uuid";

interface CartLine {
  itemId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  unitPriceCents: number;
  stock: number;
  qtyText: string;
  trackSerial: boolean;
  serials: string[];
}

interface Notice {
  kind: "error" | "info" | "ok";
  text: string;
}

interface TradeIn {
  itemName: string;
  category: string;
  value: string;
}

interface PendingSerial {
  itemId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  unitPriceCents: number;
  stock: number;
}

const parseNumber = (text: string) => {
  const n = Number(text.replace(",", ".").trim());
  return Number.isFinite(n) ? n : 0;
};
const cents = (c: number) => formatCurrency(c / 100);

interface KitComponent {
  itemId: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  unit: string;
  salePrice: number | null;
  stock: number;
  quantity: number;
}

interface KitOption {
  id: string;
  name: string;
  kitPrice: number;
  normalPrice: number;
  components: KitComponent[];
}

export function PosScreen({
  feeRates,
  discountLimitPercent,
  maxInterestPercent,
  canSeeFees,
  kits,
}: {
  feeRates: CardFeeRates;
  discountLimitPercent: number;
  maxInterestPercent: number;
  canSeeFees: boolean;
  kits?: KitOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // ---- busca / carrinho --------------------------------------------------------------------
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ q: string; hits: ProductHit[] }>({ q: "", hits: [] });
  const [showResults, setShowResults] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  // ---- bipagem de número de série (produtos com track_serial) ------------------------------
  const [pendingSerial, setPendingSerial] = useState<PendingSerial | null>(null);
  const [serialInput, setSerialInput] = useState("");
  const [serialError, setSerialError] = useState<string | null>(null);
  const [verifyingSerial, setVerifyingSerial] = useState(false);
  const serialRef = useRef<HTMLInputElement>(null);

  // ---- venda -----------------------------------------------------------------------------------
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("pix");
  const [brand, setBrand] = useState("");
  const [installments, setInstallments] = useState(2);
  const [interestText, setInterestText] = useState("");
  const [discountMode, setDiscountMode] = useState<"valor" | "percentual">("valor");
  const [discountText, setDiscountText] = useState("");
  const [notes, setNotes] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ---- entrada (troca): cliente entrega um produto usado que abate o total ----------------
  const [tradeIn, setTradeIn] = useState<TradeIn | null>(null);
  const [tradeInDraft, setTradeInDraft] = useState<TradeIn>({ itemName: "", category: "", value: "" });
  const [tradeInModal, setTradeInModal] = useState(false);

  // só mostra o resultado da busca que corresponde ao texto atual (nada de resultado velho)
  const results = found.q === query.trim() ? found.hits : [];

  const brands = useMemo(() => brandsFrom(feeRates), [feeRates]);
  const isCard = isCardMethod(method);
  const installmentsEff = method === "credito_parcelado" ? installments : 1;

  // ---- cálculo (espelho do banco; o servidor recalcula tudo) ----------------------------------
  const lines = cart.map((l) => ({ ...l, quantity: parseNumber(l.qtyText) }));
  const subtotalCents = lines.reduce((s, l) => s + lineTotalCents(l.unitPriceCents, l.quantity), 0);
  const discountRaw =
    discountMode === "valor" ? toCents(parseNumber(discountText)) : discountFromPercent(subtotalCents, parseNumber(discountText));
  const discountCents = Math.min(Math.max(discountRaw, 0), subtotalCents);
  const maxDiscount = maxDiscountCents(subtotalCents, discountLimitPercent);
  const interestPercent = method === "credito_parcelado" ? parseNumber(interestText) : 0;
  const tradeInCents = tradeIn ? toCents(parseNumber(tradeIn.value)) : 0;
  const pricing = computeSaleTotals({ subtotalCents, discountCents, method, installments: installmentsEff, interestPercent, tradeInCents });

  const key = feeKey(method, installmentsEff);
  const feePercent = isCard && brand && key !== null ? feeRates[brand]?.[key] : undefined;
  const fee = feePercent !== undefined ? computeCardFee(pricing.totalCents, feePercent) : null;

  const blocking: string[] = [];
  for (const l of lines) {
    if (l.quantity <= 0) blocking.push(`Quantidade inválida: ${l.name}`);
    else if (l.quantity > l.stock) blocking.push(`Estoque insuficiente: ${l.name} (disponível ${formatQuantity(l.stock, l.unit)})`);
  }
  if (discountRaw > subtotalCents) blocking.push("O desconto não pode ser maior que o subtotal.");
  else if (discountRaw > maxDiscount)
    blocking.push(discountLimitPercent <= 0 ? "Seu perfil não pode dar desconto." : `Desconto acima do seu limite (${discountLimitPercent}%).`);
  if (cart.length > 0 && subtotalCents > 0 && pricing.baseCents <= 0) blocking.push("O total da venda precisa ser maior que zero.");
  if (isCard && !brand) blocking.push("Escolha a bandeira do cartão.");
  if (isCard && brand && feePercent === undefined)
    blocking.push(`Sem taxa cadastrada para ${brandLabel(brand)} em ${method === "debito" ? "débito" : method === "credito_vista" ? "crédito à vista" : `${installmentsEff}x`}.`);
  if (method === "credito_parcelado" && interestPercent > maxInterestPercent) blocking.push(`Juros acima do máximo permitido (${maxInterestPercent}%).`);
  if (interestPercent < 0) blocking.push("Juros inválido.");
  if (tradeIn && tradeInCents <= 0) blocking.push("Informe o valor do produto recebido de entrada.");
  else if (tradeIn && tradeInCents >= pricing.baseCents + pricing.interestCents)
    blocking.push("O valor de entrada não pode ser maior ou igual ao total da venda.");

  const canReview = cart.length > 0 && blocking.length === 0;

  // ---- chave de idempotência: muda sempre que o conteúdo da venda muda ----------------------------
  const payload = {
    customerId: customer?.id ?? null,
    items: lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, serials: l.trackSerial ? l.serials : undefined })),
    discountAmount: discountCents / 100,
    paymentMethod: method,
    installments: installmentsEff,
    interestPercent,
    cardBrand: isCard ? brand || null : null,
    notes: notes.trim() || null,
    tradeIn: tradeIn ? { itemName: tradeIn.itemName, category: tradeIn.category.trim() || null, value: parseNumber(tradeIn.value) } : null,
  };
  const signature = JSON.stringify(payload);
  const keyRef = useRef({ signature: "", key: "" });
  const currentKey = () => {
    if (keyRef.current.signature !== signature) keyRef.current = { signature, key: uuid() };
    return keyRef.current.key;
  };

  // ---- atalhos: F2 foca a busca -----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- busca com debounce (código de barras longo espera o Enter do leitor) --------------------------------
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || /^\d{8,}$/.test(q)) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const hits = await searchProductsAction(q);
      if (mine === seq.current) setFound({ q, hits });
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (pendingSerial) serialRef.current?.focus();
  }, [pendingSerial]);

  // ---- ações -----------------------------------------------------------------------------------------------
  function addProduct(hit: ProductHit) {
    setShowResults(false);
    setQuery("");

    if (hit.sale_price === null || hit.sale_price <= 0) {
      searchRef.current?.focus();
      return setNotice({ kind: "error", text: `Produto sem preço de venda: ${hit.name}.` });
    }
    if (hit.quantity <= 0) {
      searchRef.current?.focus();
      return setNotice({ kind: "error", text: `Estoque insuficiente: ${hit.name} está sem estoque.` });
    }

    if (hit.track_serial) {
      setPendingSerial({
        itemId: hit.id,
        name: hit.name,
        sku: hit.sku,
        barcode: hit.barcode,
        unit: hit.unit,
        unitPriceCents: toCents(hit.sale_price!),
        stock: hit.quantity,
      });
      setSerialInput("");
      setSerialError(null);
      return setNotice({ kind: "info", text: `Bipe o número de série de ${hit.name}.` });
    }

    const existing = cart.find((l) => l.itemId === hit.id);
    if (existing) {
      const next = parseNumber(existing.qtyText) + 1;
      if (next > hit.quantity) {
        searchRef.current?.focus();
        return setNotice({ kind: "error", text: `Estoque insuficiente: ${hit.name} (disponível ${formatQuantity(hit.quantity, hit.unit)}).` });
      }
      setCart((c) => c.map((l) => (l.itemId === hit.id ? { ...l, stock: hit.quantity, qtyText: String(next) } : l)));
    } else {
      setCart((c) => [
        ...c,
        {
          itemId: hit.id,
          name: hit.name,
          sku: hit.sku,
          barcode: hit.barcode,
          unit: hit.unit,
          unitPriceCents: toCents(hit.sale_price!),
          stock: hit.quantity,
          qtyText: "1",
          trackSerial: false,
          serials: [],
        },
      ]);
    }
    searchRef.current?.focus();
    setNotice({ kind: "ok", text: `${hit.name} adicionado.` });
  }

  // Kit = vários produtos de uma vez, cada um baixando do próprio estoque; a diferença pro
  // preço normal vira desconto em R$ (some com o que já estiver no campo de desconto).
  function addKit(kit: KitOption) {
    for (const c of kit.components) {
      if (c.salePrice === null || c.salePrice <= 0) {
        return setNotice({ kind: "error", text: `${c.name} está sem preço de venda — ajuste o kit.` });
      }
    }
    setCart((c) => {
      let next = c;
      for (const comp of kit.components) {
        const idx = next.findIndex((l) => l.itemId === comp.itemId);
        if (idx >= 0) {
          const updated = [...next];
          updated[idx] = { ...updated[idx], qtyText: String(parseNumber(updated[idx].qtyText) + comp.quantity) };
          next = updated;
        } else {
          next = [
            ...next,
            {
              itemId: comp.itemId,
              name: comp.name,
              sku: comp.sku,
              barcode: comp.barcode,
              unit: comp.unit,
              unitPriceCents: toCents(comp.salePrice!),
              stock: comp.stock,
              qtyText: String(comp.quantity),
              trackSerial: false,
              serials: [],
            },
          ];
        }
      }
      return next;
    });
    const savingsCents = toCents(kit.normalPrice - kit.kitPrice);
    if (savingsCents > 0) {
      setDiscountMode("valor");
      setDiscountText((prev) => ((parseNumber(prev) * 100 + savingsCents) / 100).toString());
    }
    setNotice({ kind: "ok", text: `Kit "${kit.name}" adicionado.` });
    searchRef.current?.focus();
  }

  function cancelSerialScan() {
    setPendingSerial(null);
    setSerialInput("");
    setSerialError(null);
    searchRef.current?.focus();
  }

  async function confirmSerialScan() {
    const s = serialInput.trim();
    setSerialError(null);
    if (!s || !pendingSerial) return;
    if (cart.some((l) => l.serials.includes(s))) {
      return setSerialError(`${s} já foi bipado nesta venda.`);
    }
    setVerifyingSerial(true);
    const result = await verifySerialAction(pendingSerial.itemId, s);
    setVerifyingSerial(false);
    if (!result.ok) {
      setSerialError(result.error);
      return;
    }

    setCart((c) => {
      const existing = c.find((l) => l.itemId === pendingSerial.itemId);
      if (existing) {
        const nextSerials = [...existing.serials, s];
        return c.map((l) => (l.itemId === pendingSerial.itemId ? { ...l, serials: nextSerials, qtyText: String(nextSerials.length) } : l));
      }
      return [
        ...c,
        {
          itemId: pendingSerial.itemId,
          name: pendingSerial.name,
          sku: pendingSerial.sku,
          barcode: pendingSerial.barcode,
          unit: pendingSerial.unit,
          unitPriceCents: pendingSerial.unitPriceCents,
          stock: pendingSerial.stock,
          qtyText: "1",
          trackSerial: true,
          serials: [s],
        },
      ];
    });
    setNotice({ kind: "ok", text: `${pendingSerial.name} — ${s} adicionado.` });
    setPendingSerial(null);
    setSerialInput("");
    searchRef.current?.focus();
  }

  function removeSerialFromLine(itemId: string, serial: string) {
    setCart((c) =>
      c.flatMap((l) => {
        if (l.itemId !== itemId) return [l];
        const nextSerials = l.serials.filter((s) => s !== serial);
        return nextSerials.length === 0 ? [] : [{ ...l, serials: nextSerials, qtyText: String(nextSerials.length) }];
      })
    );
  }

  async function submitSearch() {
    const q = query.trim();
    if (!q) return;
    setNotice(null);
    const hits = await searchProductsAction(q);
    const exact = hits.find((h) => h.match !== "name");
    if (exact) return addProduct(exact);
    if (hits.length === 1) return addProduct(hits[0]);
    if (hits.length === 0) return setNotice({ kind: "error", text: "Produto não encontrado." });
    setFound({ q, hits });
    setShowResults(true);
    setNotice({ kind: "info", text: "Vários produtos encontrados — escolha um na lista." });
  }

  const setQty = (itemId: string, text: string) => setCart((c) => c.map((l) => (l.itemId === itemId ? { ...l, qtyText: text } : l)));
  const stepQty = (l: CartLine, delta: number) => {
    const step = l.unit === "un" ? 1 : 0.5;
    const next = Math.max(step, +(parseNumber(l.qtyText) + delta * step).toFixed(3));
    setQty(l.itemId, String(next));
  };
  const removeLine = (itemId: string) => setCart((c) => c.filter((l) => l.itemId !== itemId));

  function changeMethod(next: PaymentMethod) {
    setMethod(next);
    const nextKey = feeKey(next, next === "credito_parcelado" ? installments : 1);
    if (brand && (nextKey === null || feeRates[brand]?.[nextKey] === undefined)) setBrand("");
    if (next !== "credito_parcelado") setInterestText("");
  }

  function changeBrand(next: string) {
    setBrand(next);
    if (method === "credito_parcelado" && next && feeRates[next]?.[installments] === undefined) {
      const first = Array.from({ length: MAX_INSTALLMENTS - 1 }, (_, i) => i + 2).find((n) => feeRates[next]?.[n] !== undefined);
      if (first) setInstallments(first);
    }
  }

  function confirmSale() {
    setSubmitError(null);
    const idempotencyKey = currentKey();
    startTransition(async () => {
      const result = await createSaleAction({ idempotencyKey, ...payload });
      if (!result.ok) return setSubmitError(result.error);
      router.push(`/vendas/${result.data.saleId}?criada=1`);
    });
  }

  const brandOptionDisabled = (b: string) => (key === null ? false : feeRates[b]?.[key] === undefined);

  // ---- UI ------------------------------------------------------------------------------------------------------
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      {/* ===== esquerda: busca + carrinho ===== */}
      <section className="flex min-w-0 flex-col gap-4">
        <div className="card relative flex flex-col gap-2">
          <label htmlFor="pos_search" className="label mb-0 flex items-center justify-between">
            <span>Produto</span>
            <span className="text-xs font-normal text-muted">F2 para focar · Enter adiciona</span>
          </label>
          <div className="relative">
            <ScanBarcode size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="pos_search"
              ref={searchRef}
              autoFocus
              autoComplete="off"
              disabled={!!pendingSerial}
              className="input h-11 pl-10 text-base disabled:opacity-50"
              placeholder="Bipe o código de barras ou digite nome/SKU"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowResults(true);
              }}
              onFocus={() => setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 150)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitSearch();
                } else if (e.key === "Escape") setShowResults(false);
              }}
            />
          </div>

          {notice && (
            <p
              role="status"
              className={cn(
                "flex items-center gap-1.5 text-sm font-medium",
                notice.kind === "error" && "text-danger",
                notice.kind === "ok" && "text-success",
                notice.kind === "info" && "text-muted"
              )}
            >
              {notice.kind === "error" ? <AlertTriangle size={14} /> : notice.kind === "ok" ? <CheckCircle2 size={14} /> : null}
              {notice.text}
            </p>
          )}

          {showResults && results.length > 0 && (
            <ul className="absolute left-4 right-4 top-[92px] z-20 max-h-72 overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-background"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addProduct(r)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">{r.name}</span>
                      <span className="block truncate text-xs text-muted">{[r.sku, r.barcode].filter(Boolean).join(" · ") || "sem código"}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-medium text-foreground">{r.sale_price === null ? "sem preço" : formatCurrency(r.sale_price)}</span>
                      <span className={cn("block text-xs", r.quantity <= 0 ? "text-danger" : "text-muted")}>
                        {r.quantity <= 0 ? "sem estoque" : `${formatQuantity(r.quantity, r.unit)} em estoque`}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {pendingSerial && (
          <div className="card flex flex-col gap-2 border-accent/40 bg-accent/5">
            <label htmlFor="pos_serial" className="label mb-0">
              Número de série de {pendingSerial.name}
            </label>
            <div className="flex gap-2">
              <input
                id="pos_serial"
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
                    void confirmSerialScan();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelSerialScan();
                  }
                }}
                disabled={verifyingSerial}
              />
              <button type="button" className="btn-secondary" onClick={cancelSerialScan}>
                Cancelar
              </button>
            </div>
            {serialError && (
              <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
                <AlertTriangle size={14} /> {serialError}
              </p>
            )}
          </div>
        )}

        {!!kits?.length && (
          <div className="card flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">Kits</h2>
            <div className="flex flex-wrap gap-2">
              {kits.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => addKit(k)}
                  className="rounded-md border border-border bg-background px-3 py-2 text-left text-sm hover:border-accent"
                  title={k.components.map((c) => `${c.quantity}x ${c.name}`).join(", ")}
                >
                  <span className="block font-medium text-foreground">{k.name}</span>
                  <span className="block text-xs text-muted">
                    {cents(toCents(k.kitPrice))}
                    {k.normalPrice > k.kitPrice && <span className="ml-1 line-through">{cents(toCents(k.normalPrice))}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card overflow-x-auto p-0">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-16 text-center text-muted">
              <ShoppingCart size={28} className="opacity-50" />
              <p className="text-sm">Carrinho vazio.</p>
              <p className="text-xs">Bipe um código de barras ou busque pelo nome para começar a venda.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Produto</th>
                  <th className="px-4 py-3 text-right">Preço</th>
                  <th className="px-4 py-3">Qtd</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const over = l.quantity > l.stock;
                  const invalid = l.quantity <= 0;
                  return (
                    <tr key={l.itemId} className="border-b border-border last:border-0">
                      <td className="max-w-[260px] px-4 py-3">
                        <p className="truncate font-medium text-foreground">{l.name}</p>
                        <p className={cn("text-xs", over ? "font-medium text-danger" : "text-muted")}>
                          {over ? `Estoque insuficiente — disponível ${formatQuantity(l.stock, l.unit)}` : `Estoque: ${formatQuantity(l.stock, l.unit)}`}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{cents(l.unitPriceCents)}</td>
                      <td className="px-4 py-3">
                        {l.trackSerial ? (
                          <div className="flex flex-col gap-1">
                            <span className="text-sm tabular-nums text-foreground">{l.serials.length}</span>
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
                          <div className="flex items-center gap-1">
                            <button type="button" className="rounded border border-border p-1 hover:bg-background" onClick={() => stepQty(l, -1)} aria-label="Diminuir">
                              <Minus size={14} />
                            </button>
                            <input
                              inputMode="decimal"
                              aria-label={`Quantidade de ${l.name}`}
                              className={cn("input h-8 w-16 px-1 text-center", (over || invalid) && "border-danger")}
                              value={l.qtyText}
                              onChange={(e) => setQty(l.itemId, e.target.value)}
                            />
                            <button type="button" className="rounded border border-border p-1 hover:bg-background" onClick={() => stepQty(l, 1)} aria-label="Aumentar">
                              <Plus size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums text-foreground">
                        {cents(lineTotalCents(l.unitPriceCents, l.quantity))}
                      </td>
                      <td className="px-2 py-3">
                        <button type="button" className="rounded p-1.5 text-muted hover:bg-background hover:text-danger" onClick={() => removeLine(l.itemId)} aria-label={`Remover ${l.name}`}>
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* ===== direita: cliente, pagamento, totais ===== */}
      <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
        <div className="card flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Cliente</h2>
          <CustomerPicker value={customer} onChange={setCustomer} />
        </div>

        <div className="card flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-foreground">Pagamento</h2>
          <div className="grid grid-cols-2 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => changeMethod(m)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                  m === "credito_parcelado" && "col-span-2",
                  method === m ? "border-accent bg-accent/15 text-foreground" : "border-border bg-background text-muted hover:text-foreground"
                )}
              >
                {PAYMENT_LABEL[m]}
              </button>
            ))}
          </div>

          {isCard && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="pos_brand">
                  Bandeira
                </label>
                <select id="pos_brand" className="input" value={brand} onChange={(e) => changeBrand(e.target.value)}>
                  <option value="">Selecione...</option>
                  {brands.map((b) => (
                    <option key={b} value={b} disabled={brandOptionDisabled(b)}>
                      {brandLabel(b)}
                      {brandOptionDisabled(b) ? " (sem taxa)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              {method === "credito_parcelado" && (
                <div>
                  <label className="label" htmlFor="pos_inst">
                    Parcelas
                  </label>
                  <select id="pos_inst" className="input" value={installments} onChange={(e) => setInstallments(Number(e.target.value))}>
                    {Array.from({ length: MAX_INSTALLMENTS - 1 }, (_, i) => i + 2).map((n) => (
                      <option key={n} value={n} disabled={Boolean(brand) && feeRates[brand]?.[n] === undefined}>
                        {n}x
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {method === "credito_parcelado" && (
                <div className="col-span-2">
                  <label className="label" htmlFor="pos_interest">
                    Juros cobrado do cliente (%) <span className="font-normal text-muted">— máx. {maxInterestPercent}%</span>
                  </label>
                  <input id="pos_interest" inputMode="decimal" className="input" placeholder="0" value={interestText} onChange={(e) => setInterestText(e.target.value)} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Entrada (troca)</h2>
            {!tradeIn && (
              <button
                type="button"
                className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                onClick={() => {
                  setTradeInDraft({ itemName: "", category: "", value: "" });
                  setTradeInModal(true);
                }}
              >
                <Repeat size={13} /> Recebeu algo de entrada?
              </button>
            )}
          </div>
          {tradeIn ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{tradeIn.itemName}</p>
                <p className="text-xs text-muted">{cents(tradeInCents)} abatido do total</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="rounded p-1.5 text-muted hover:bg-surface hover:text-foreground"
                  onClick={() => {
                    setTradeInDraft(tradeIn);
                    setTradeInModal(true);
                  }}
                  aria-label="Editar entrada"
                >
                  <Repeat size={14} />
                </button>
                <button type="button" className="rounded p-1.5 text-muted hover:bg-surface hover:text-danger" onClick={() => setTradeIn(null)} aria-label="Remover entrada">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted">Ex.: cliente entrega o relógio usado e o valor abate o total da venda.</p>
          )}
        </div>

        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Desconto</h2>
            <div className="flex gap-1 rounded-md bg-background p-0.5 text-xs">
              {(["valor", "percentual"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={discountLimitPercent <= 0}
                  onClick={() => setDiscountMode(m)}
                  className={cn("rounded px-2 py-1 font-medium", discountMode === m ? "bg-surface text-foreground" : "text-muted", discountLimitPercent <= 0 && "opacity-50")}
                >
                  {m === "valor" ? "R$" : "%"}
                </button>
              ))}
            </div>
          </div>
          <input
            inputMode="decimal"
            className="input"
            placeholder={discountLimitPercent <= 0 ? "Seu perfil não dá desconto" : discountMode === "valor" ? "0,00" : "0"}
            disabled={discountLimitPercent <= 0}
            value={discountText}
            onChange={(e) => setDiscountText(e.target.value)}
          />
          {discountLimitPercent > 0 && (
            <p className="text-xs text-muted">
              Seu limite: {discountLimitPercent}%{subtotalCents > 0 ? ` (até ${cents(maxDiscount)} nesta venda)` : ""}
            </p>
          )}
        </div>

        <div className="card flex flex-col gap-2">
          <Row label="Subtotal" value={cents(pricing.subtotalCents)} />
          {pricing.discountCents > 0 && <Row label="Desconto" value={`− ${cents(pricing.discountCents)}`} className="text-success" />}
          {pricing.interestCents > 0 && <Row label={`Juros (${interestPercent.toLocaleString("pt-BR")}%)`} value={`+ ${cents(pricing.interestCents)}`} className="text-warning" />}
          {pricing.tradeInCents > 0 && <Row label="Entrada (troca)" value={`− ${cents(pricing.tradeInCents)}`} className="text-success" />}
          <div className="my-1 border-t border-border" />
          <div className="flex items-end justify-between">
            <span className="text-sm text-muted">Total</span>
            <span className="text-2xl font-semibold tabular-nums text-foreground">{cents(pricing.totalCents)}</span>
          </div>
          {method === "credito_parcelado" && (
            <p className="text-right text-xs text-muted">
              {installments}x de {cents(pricing.installmentCents)}
            </p>
          )}
          {canSeeFees && fee && feePercent !== undefined && (
            <div className="mt-1 rounded-md bg-background px-3 py-2 text-xs text-muted">
              <div className="flex justify-between">
                <span>Taxa da operadora ({feePercent.toLocaleString("pt-BR")}%)</span>
                <span className="text-danger">− {cents(fee.feeCents)}</span>
              </div>
              <div className="flex justify-between font-medium text-foreground">
                <span>Líquido a receber</span>
                <span>{cents(fee.netCents)}</span>
              </div>
            </div>
          )}

          {blocking.length > 0 && cart.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1">
              {blocking.map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-xs font-medium text-danger">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {b}
                </li>
              ))}
            </ul>
          )}

          <button type="button" className="btn-primary mt-2 h-11 text-base" disabled={!canReview || pending || !!pendingSerial} onClick={() => setReviewing(true)}>
            Revisar venda
          </button>
          {cart.length > 0 && (
            <button
              type="button"
              className="text-xs text-muted hover:text-danger"
              onClick={() => {
                if (confirm("Limpar o carrinho?")) {
                  setCart([]);
                  setDiscountText("");
                  setTradeIn(null);
                }
              }}
            >
              Limpar carrinho
            </button>
          )}
        </div>
      </aside>

      {/* ===== resumo antes de confirmar ===== */}
      <Modal open={reviewing} onOpenChange={(o) => !pending && setReviewing(o)} title="Resumo da venda" description="Confira antes de confirmar. Depois de confirmada, a venda só pode ser cancelada ou devolvida.">
        <div className="flex flex-col gap-4 text-sm">
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
            {lines.map((l) => (
              <li key={l.itemId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0">
                  <span className="block truncate">
                    {formatQuantity(l.quantity)}× {l.name}
                  </span>
                  {l.trackSerial && <span className="block truncate font-mono text-xs text-muted">{l.serials.join(", ")}</span>}
                </span>
                <span className="shrink-0 tabular-nums">{cents(lineTotalCents(l.unitPriceCents, l.quantity))}</span>
              </li>
            ))}
          </ul>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <dt className="text-muted">Cliente</dt>
            <dd className="text-right">{customer ? customer.name : "Não informado"}</dd>
            <dt className="text-muted">Pagamento</dt>
            <dd className="text-right">
              {PAYMENT_LABEL[method]}
              {isCard && brand ? ` · ${brandLabel(brand)}` : ""}
              {method === "credito_parcelado" ? ` · ${installments}x de ${cents(pricing.installmentCents)}` : ""}
            </dd>
            <dt className="text-muted">Subtotal</dt>
            <dd className="text-right tabular-nums">{cents(pricing.subtotalCents)}</dd>
            {pricing.discountCents > 0 && (
              <>
                <dt className="text-muted">Desconto</dt>
                <dd className="text-right tabular-nums text-success">− {cents(pricing.discountCents)}</dd>
                <dt className="text-muted">Valor da venda</dt>
                <dd className="text-right tabular-nums">{cents(pricing.baseCents)}</dd>
              </>
            )}
            {pricing.interestCents > 0 && (
              <>
                <dt className="text-muted">Juros</dt>
                <dd className="text-right tabular-nums text-warning">+ {cents(pricing.interestCents)}</dd>
              </>
            )}
            {pricing.tradeInCents > 0 && (
              <>
                <dt className="text-muted">Entrada ({tradeIn?.itemName})</dt>
                <dd className="text-right tabular-nums text-success">− {cents(pricing.tradeInCents)}</dd>
              </>
            )}
            <dt className="text-base font-semibold text-foreground">Total</dt>
            <dd className="text-right text-lg font-semibold tabular-nums text-foreground">{cents(pricing.totalCents)}</dd>
          </dl>

          <div>
            <label className="label" htmlFor="pos_notes">
              Observação (opcional)
            </label>
            <input id="pos_notes" className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {submitError && (
            <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {submitError}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => setReviewing(false)}>
              Voltar
            </button>
            <button type="button" className="btn-primary" disabled={pending} onClick={confirmSale}>
              {pending ? "Registrando..." : "Confirmar venda"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ===== entrada (troca): produto usado que o cliente entrega ===== */}
      <Modal
        open={tradeInModal}
        onOpenChange={setTradeInModal}
        title="Recebeu algo de entrada?"
        description="O valor abate o total da venda. O produto entra automaticamente no estoque como seminovo."
      >
        <div className="flex flex-col gap-3">
          <div>
            <label className="label" htmlFor="ti_name">
              Produto recebido *
            </label>
            <input
              id="ti_name"
              autoFocus
              className="input"
              placeholder="Ex: Relógio Casio usado"
              value={tradeInDraft.itemName}
              onChange={(e) => setTradeInDraft((d) => ({ ...d, itemName: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="ti_category">
                Categoria
              </label>
              <input
                id="ti_category"
                className="input"
                placeholder="Opcional"
                value={tradeInDraft.category}
                onChange={(e) => setTradeInDraft((d) => ({ ...d, category: e.target.value }))}
              />
            </div>
            <div>
              <label className="label" htmlFor="ti_value">
                Valor de entrada (R$) *
              </label>
              <input
                id="ti_value"
                inputMode="decimal"
                className="input"
                placeholder="0,00"
                value={tradeInDraft.value}
                onChange={(e) => setTradeInDraft((d) => ({ ...d, value: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setTradeInModal(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!tradeInDraft.itemName.trim() || parseNumber(tradeInDraft.value) <= 0}
              onClick={() => {
                setTradeIn(tradeInDraft);
                setTradeInModal(false);
              }}
            >
              Salvar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className={cn("tabular-nums text-foreground", className)}>{value}</span>
    </div>
  );
}
