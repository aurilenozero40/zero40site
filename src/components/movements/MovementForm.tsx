"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ScanBarcode, X } from "lucide-react";
import { cn, formatQuantity } from "@/lib/utils";
import { normalizeBarcode } from "@/lib/barcode";
import { createSupplierQuickAction, listAvailableSerialsAction, type SupplierHit } from "@/app/(app)/movimentacoes/actions";
import type { Item } from "@/lib/types";
import type { ActionState } from "@/app/(app)/movimentacoes/actions";

const ENTRADA_SUBTYPES = [
  { value: "compra", label: "Compra" },
  { value: "devolucao", label: "Devolução" },
  { value: "transferencia", label: "Transferência" },
  { value: "outros", label: "Outros" },
];

// Venda NÃO está aqui de propósito: toda venda nasce no PDV (Nova venda), com cliente, pagamento e auditoria.
const SAIDA_SUBTYPES = [
  { value: "perda", label: "Perda (quebra, vencimento, sumiço)" },
  { value: "uso", label: "Uso interno" },
  { value: "emprestimo", label: "Empréstimo" },
  { value: "outros", label: "Outros" },
];

export function MovementForm({
  action,
  items,
  suppliers,
  defaultItemId,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  items: Item[];
  suppliers: SupplierHit[];
  defaultItemId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const [type, setType] = useState<"entrada" | "saida" | "ajuste">("entrada");
  const [itemId, setItemId] = useState(defaultItemId ?? "");
  const [entradaSubtype, setEntradaSubtype] = useState("compra");
  const [saidaSubtype, setSaidaSubtype] = useState("perda");
  const [saidaQuantity, setSaidaQuantity] = useState("");
  const [ajusteQuantity, setAjusteQuantity] = useState("");
  const [ajusteDirection, setAjusteDirection] = useState<"aumenta" | "diminui">("diminui");

  // Leitor de código de barras: o leitor digita o código + Enter.
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanStatus, setScanStatus] = useState<{ ok: boolean; message: string } | null>(null);

  // Bipagem de número de série (produtos com track_serial): entrada cadastra serial novo;
  // saída/ajuste-diminui exige escolher um serial que já está em estoque.
  const [serials, setSerials] = useState<string[]>([]);
  const [serialInput, setSerialInput] = useState("");
  const [serialError, setSerialError] = useState<string | null>(null);
  // guarda de qual item é a lista carregada — evita mostrar seriais do item anterior durante o fetch
  const [availableSerials, setAvailableSerials] = useState<{ itemId: string; list: string[] } | null>(null);

  // Fornecedor da entrada: uma vez escolhido pra um item, o próprio item "lembra" (supplier_id) e
  // vem pré-selecionado nas próximas entradas — só pergunta de novo se quiser trocar.
  const [localSuppliers, setLocalSuppliers] = useState(suppliers);
  const [supplierId, setSupplierId] = useState(() => items.find((i) => i.id === (defaultItemId ?? ""))?.supplier_id ?? "");

  const selectedItem = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);
  const isDecreaseMode = type === "saida" || (type === "ajuste" && ajusteDirection === "diminui");

  // Zera os seriais bipados sempre que troca de item, de aba ou de direção do ajuste
  // (chamado nos três lugares que mudam esse estado, abaixo — não num efeito).
  function resetSerialScan() {
    setSerials([]);
    setSerialInput("");
    setSerialError(null);
  }

  // Em saída/ajuste-diminui precisa saber QUAIS seriais estão disponíveis pra escolher.
  // Se não se aplica, o efeito simplesmente não busca nada — a lista antiga fica ignorada
  // porque `remainingAvailable`/o card só são exibidos quando isDecreaseMode é verdadeiro.
  useEffect(() => {
    if (!selectedItem?.track_serial || !isDecreaseMode) return;
    let cancelled = false;
    listAvailableSerialsAction(selectedItem.id).then((list) => {
      if (!cancelled) setAvailableSerials({ itemId: selectedItem.id, list });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedItem?.id, selectedItem?.track_serial, isDecreaseMode]);

  const loadingAvailable = !!selectedItem?.track_serial && isDecreaseMode && availableSerials?.itemId !== selectedItem?.id;

  // Aviso em tempo real; a trava de verdade (corrida entre duas pessoas) é no servidor + no banco.
  const saidaExceedsStock =
    !!selectedItem && saidaQuantity.trim() !== "" && Number(saidaQuantity) > selectedItem.quantity;
  const ajusteExceedsStock =
    !!selectedItem &&
    ajusteDirection === "diminui" &&
    ajusteQuantity.trim() !== "" &&
    Number(ajusteQuantity) > selectedItem.quantity;

  function handleBarcodeScan() {
    const normalized = normalizeBarcode(barcodeInput);
    if (!normalized) return;

    const found = items.find((i) => normalizeBarcode(i.barcode) === normalized);
    if (!found) {
      setScanStatus({
        ok: false,
        message: `Nenhum item ativo com o código ${barcodeInput.trim()}. Confira o código ou cadastre o item.`,
      });
      return;
    }

    setItemId(found.id);
    resetSerialScan();
    setSupplierId(found.supplier_id ?? "");
    setScanStatus({ ok: true, message: `${found.name} selecionado.` });
    setBarcodeInput("");
    // Já leva o cursor pro próximo passo: seriais (se o item usa) ou quantidade.
    document.getElementById(found.track_serial ? "serial_scan" : `${type}_quantity`)?.focus();
  }

  function addSerial() {
    const s = serialInput.trim();
    setSerialError(null);
    if (!s) return;
    if (serials.includes(s)) {
      setSerialError(`${s} já foi bipado nesta movimentação.`);
      return;
    }
    if (isDecreaseMode) {
      const list = availableSerials !== null && availableSerials.itemId === selectedItem?.id ? availableSerials.list : [];
      if (!list.includes(s)) {
        setSerialError(`${s} não está em estoque para este produto.`);
        return;
      }
    }
    setSerials((prev) => [...prev, s]);
    setSerialInput("");
  }

  function removeSerial(s: string) {
    setSerials((prev) => prev.filter((x) => x !== s));
  }

  const remainingAvailable =
    availableSerials !== null && availableSerials.itemId === selectedItem?.id
      ? availableSerials.list.filter((s) => !serials.includes(s))
      : [];

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="card flex flex-col gap-2">
        <div className="mb-2 flex flex-col gap-1">
          <label className="label mb-0" htmlFor="barcode_scan">
            Código de barras
          </label>
          <div className="relative">
            <ScanBarcode
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              id="barcode_scan"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              autoFocus={!defaultItemId}
              placeholder="Bipe o código ou digite e aperte Enter"
              className="input pl-9"
              value={barcodeInput}
              onChange={(e) => {
                setBarcodeInput(e.target.value);
                setScanStatus(null);
              }}
              onKeyDown={(e) => {
                // Enter do leitor não pode enviar o formulário.
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleBarcodeScan();
                }
              }}
            />
          </div>
          {scanStatus && (
            <p
              role="status"
              className={cn("text-xs font-medium", scanStatus.ok ? "text-success" : "text-danger")}
            >
              {scanStatus.message}
            </p>
          )}
        </div>

        <label className="label" htmlFor="item_id">
          Item *
        </label>
        <select
          id="item_id"
          name="item_id"
          required
          className="input"
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            resetSerialScan();
            setSupplierId(items.find((i) => i.id === e.target.value)?.supplier_id ?? "");
          }}
        >
          <option value="" disabled>
            Selecione um item...
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} {item.sku ? `(${item.sku})` : ""}
            </option>
          ))}
        </select>
        {selectedItem && (
          <p className="text-xs text-muted">
            Estoque atual: {formatQuantity(selectedItem.quantity, selectedItem.unit)} · mínimo{" "}
            {formatQuantity(selectedItem.min_stock, selectedItem.unit)}
            {selectedItem.track_serial && " · usa número de série"}
          </p>
        )}
      </div>

      <Tabs.Root
        value={type}
        onValueChange={(v) => {
          setType(v as typeof type);
          resetSerialScan();
        }}
        className="card flex flex-col gap-4"
      >
        <Tabs.List className="flex gap-1 rounded-md bg-background p-1">
          {(["entrada", "saida", "ajuste"] as const).map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors",
                type === t
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {t === "saida" ? "Saída" : t}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <input type="hidden" name="type" value={type} />
        {selectedItem?.track_serial && (
          <>
            <input type="hidden" name="quantity" value={serials.length || ""} />
            <input type="hidden" name="serials" value={JSON.stringify(serials)} />
          </>
        )}

        <Tabs.Content value="entrada" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="entrada_subtype">
                Motivo da entrada *
              </label>
              <select
                id="entrada_subtype"
                name="subtype"
                required
                className="input"
                value={entradaSubtype}
                onChange={(e) => setEntradaSubtype(e.target.value)}
              >
                {ENTRADA_SUBTYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedItem?.track_serial ? (
              <SerialScanField
                label="Números de série que estão entrando *"
                helper="Bipe o número de série de cada unidade — a quantidade é a soma dos seriais."
                serials={serials}
                serialInput={serialInput}
                onChangeInput={setSerialInput}
                onAdd={addSerial}
                onRemove={removeSerial}
                error={serialError}
              />
            ) : (
              <div>
                <label className="label" htmlFor="entrada_quantity">
                  Quantidade *
                </label>
                <input
                  id="entrada_quantity"
                  name="quantity"
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  className="input"
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor="entrada_unit_value">
                Valor de entrada (R$/un)
              </label>
              <input
                id="entrada_unit_value"
                name="unit_value"
                type="number"
                step="0.01"
                min="0"
                className="input"
              />
            </div>
            <SupplierField
              suppliers={localSuppliers}
              value={supplierId}
              onChange={setSupplierId}
              onCreated={(s) => {
                setLocalSuppliers((prev) => [...prev, s].sort((a, b) => a.name.localeCompare(b.name)));
                setSupplierId(s.id);
              }}
              required={entradaSubtype === "compra" && !supplierId}
              remembered={selectedItem?.supplier_id === supplierId && !!supplierId}
            />
          </div>
          <div>
            <label className="label" htmlFor="entrada_reason">
              Observação
            </label>
            <input id="entrada_reason" name="reason" className="input" />
          </div>
        </Tabs.Content>

        <Tabs.Content value="saida" className="flex flex-col gap-4">
          <p className="rounded-md bg-background px-3 py-2 text-xs text-muted">
            Para <strong>vender</strong>, use <strong>Nova venda</strong> — é lá que ficam cliente, pagamento e o aviso ao CEO.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="saida_subtype">
                Motivo da saída *
              </label>
              <select
                id="saida_subtype"
                name="subtype"
                required
                className="input"
                value={saidaSubtype}
                onChange={(e) => setSaidaSubtype(e.target.value)}
              >
                {SAIDA_SUBTYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedItem?.track_serial ? (
              <SerialScanField
                label="Números de série que estão saindo *"
                helper="Bipe (ou escolha na lista) o número de série de cada unidade que sai."
                serials={serials}
                serialInput={serialInput}
                onChangeInput={setSerialInput}
                onAdd={addSerial}
                onRemove={removeSerial}
                error={serialError}
                available={remainingAvailable}
                loadingAvailable={loadingAvailable}
                onPickAvailable={(s) => {
                  setSerialInput(s);
                  setSerialError(null);
                  setSerials((prev) => (prev.includes(s) ? prev : [...prev, s]));
                  setSerialInput("");
                }}
              />
            ) : (
              <div>
                <label className="label" htmlFor="saida_quantity">
                  Quantidade *
                </label>
                <input
                  id="saida_quantity"
                  name="quantity"
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  className="input"
                  value={saidaQuantity}
                  onChange={(e) => setSaidaQuantity(e.target.value)}
                />
              </div>
            )}
          </div>

          {selectedItem && !selectedItem.track_serial && saidaExceedsStock && (
            <p className="text-sm font-medium text-danger">
              Estoque insuficiente: só tem {formatQuantity(selectedItem.quantity, selectedItem.unit)}{" "}
              disponível.
            </p>
          )}

          <div>
            <label className="label" htmlFor="saida_reason">
              {saidaSubtype === "perda" ? "Motivo da perda *" : "Observação"}
            </label>
            <input
              id="saida_reason"
              name="reason"
              required={saidaSubtype === "perda"}
              placeholder={saidaSubtype === "perda" ? "Ex: quebrou no transporte, venceu, sumiu..." : undefined}
              className="input"
            />
          </div>
        </Tabs.Content>

        <Tabs.Content value="ajuste" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="direction">
                Direção *
              </label>
              <select
                id="direction"
                name="direction"
                required
                className="input"
                value={ajusteDirection}
                onChange={(e) => {
                  setAjusteDirection(e.target.value as "aumenta" | "diminui");
                  resetSerialScan();
                }}
              >
                <option value="aumenta">Aumenta o estoque</option>
                <option value="diminui">Diminui o estoque</option>
              </select>
            </div>
            {!selectedItem?.track_serial && (
              <div>
                <label className="label" htmlFor="ajuste_quantity">
                  Quantidade *
                </label>
                <input
                  id="ajuste_quantity"
                  name="quantity"
                  type="number"
                  step="0.001"
                  min="0.001"
                  required
                  className="input"
                  value={ajusteQuantity}
                  onChange={(e) => setAjusteQuantity(e.target.value)}
                />
              </div>
            )}
          </div>

          {selectedItem?.track_serial && (
            <SerialScanField
              label={`Números de série que ${ajusteDirection === "aumenta" ? "estão entrando" : "estão saindo"} *`}
              helper={
                ajusteDirection === "aumenta"
                  ? "Bipe o número de série de cada unidade — para corrigir uma contagem, por exemplo."
                  : "Bipe (ou escolha na lista) o número de série de cada unidade que sai do estoque."
              }
              serials={serials}
              serialInput={serialInput}
              onChangeInput={setSerialInput}
              onAdd={addSerial}
              onRemove={removeSerial}
              error={serialError}
              available={ajusteDirection === "diminui" ? remainingAvailable : undefined}
              loadingAvailable={ajusteDirection === "diminui" ? loadingAvailable : false}
              onPickAvailable={
                ajusteDirection === "diminui"
                  ? (s) => {
                      setSerialError(null);
                      setSerials((prev) => (prev.includes(s) ? prev : [...prev, s]));
                    }
                  : undefined
              }
            />
          )}

          {selectedItem && !selectedItem.track_serial && ajusteExceedsStock && (
            <p className="text-sm font-medium text-danger">
              Estoque insuficiente: só tem {formatQuantity(selectedItem.quantity, selectedItem.unit)}{" "}
              disponível.
            </p>
          )}

          <div>
            <label className="label" htmlFor="ajuste_reason">
              Motivo *
            </label>
            <textarea
              id="ajuste_reason"
              name="reason"
              required
              rows={2}
              className="input"
              placeholder="Ex: avaria em transporte, contagem de inventário..."
            />
          </div>
        </Tabs.Content>
      </Tabs.Root>

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}

      <div>
        <button
          type="submit"
          className="btn-primary"
          disabled={
            pending ||
            (selectedItem?.track_serial && serials.length === 0) ||
            (!selectedItem?.track_serial && type === "saida" && saidaExceedsStock) ||
            (!selectedItem?.track_serial && type === "ajuste" && ajusteExceedsStock) ||
            (type === "entrada" && entradaSubtype === "compra" && !supplierId)
          }
        >
          {pending ? "Salvando..." : "Registrar movimentação"}
        </button>
      </div>
    </form>
  );
}

function SupplierField({
  suppliers,
  value,
  onChange,
  onCreated,
  required,
  remembered,
}: {
  suppliers: SupplierHit[];
  value: string;
  onChange: (id: string) => void;
  onCreated: (s: SupplierHit) => void;
  required: boolean;
  remembered: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitNew() {
    if (!name.trim()) return;
    setError(null);
    setPending(true);
    const r = await createSupplierQuickAction(name);
    setPending(false);
    if (r.error || !r.data) return setError(r.error ?? "Não foi possível cadastrar o fornecedor.");
    onCreated(r.data);
    setAdding(false);
    setName("");
  }

  return (
    <div>
      <label className="label" htmlFor="supplier_id">
        Fornecedor{required ? " *" : ""}
      </label>
      {adding ? (
        <div className="flex gap-2">
          <input
            autoFocus
            className="input"
            placeholder="Nome do fornecedor"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void submitNew();
              }
            }}
          />
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => {
              setAdding(false);
              setName("");
              setError(null);
            }}
          >
            Cancelar
          </button>
          <button type="button" className="btn-primary shrink-0" disabled={pending || !name.trim()} onClick={submitNew}>
            {pending ? "..." : "Adicionar"}
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <select id="supplier_id" name="supplier_id" className="input" value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Selecione...</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary shrink-0" onClick={() => setAdding(true)}>
            + Novo
          </button>
        </div>
      )}
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
      {remembered && <p className="mt-1 text-xs text-muted">Lembrado deste produto — troque se essa unidade veio de outro fornecedor.</p>}
    </div>
  );
}

function SerialScanField({
  label,
  helper,
  serials,
  serialInput,
  onChangeInput,
  onAdd,
  onRemove,
  error,
  available,
  loadingAvailable,
  onPickAvailable,
}: {
  label: string;
  helper: string;
  serials: string[];
  serialInput: string;
  onChangeInput: (v: string) => void;
  onAdd: () => void;
  onRemove: (s: string) => void;
  error: string | null;
  available?: string[];
  loadingAvailable?: boolean;
  onPickAvailable?: (s: string) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <label className="label" htmlFor="serial_scan">
        {label}
      </label>
      <input
        id="serial_scan"
        type="text"
        autoComplete="off"
        placeholder="Bipe o número de série e aperte Enter"
        className="input"
        value={serialInput}
        onChange={(e) => onChangeInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onAdd();
          }
        }}
      />
      <p className="mt-1 text-xs text-muted">{helper}</p>
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}

      {serials.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {serials.map((s) => (
            <li
              key={s}
              className="flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 font-mono text-xs text-foreground"
            >
              {s}
              <button type="button" onClick={() => onRemove(s)} aria-label={`Remover ${s}`} className="text-muted hover:text-danger">
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {available !== undefined && (
        <div className="mt-2">
          {loadingAvailable ? (
            <p className="text-xs text-muted">Carregando seriais em estoque...</p>
          ) : available.length === 0 ? (
            <p className="text-xs text-muted">Nenhum número de série disponível em estoque para este produto.</p>
          ) : (
            <>
              <p className="text-xs text-muted">Ou escolha um dos {available.length} em estoque:</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {available.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      className="rounded-full border border-border px-2.5 py-1 font-mono text-xs text-foreground hover:bg-background"
                      onClick={() => onPickAvailable?.(s)}
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
