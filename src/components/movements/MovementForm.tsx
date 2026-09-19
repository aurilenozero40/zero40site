"use client";

import { useActionState, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ScanBarcode } from "lucide-react";
import { cn, formatQuantity } from "@/lib/utils";
import { normalizeBarcode } from "@/lib/barcode";
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
  defaultItemId,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  items: Item[];
  defaultItemId?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const [type, setType] = useState<"entrada" | "saida" | "ajuste">("entrada");
  const [itemId, setItemId] = useState(defaultItemId ?? "");
  const [saidaSubtype, setSaidaSubtype] = useState("perda");
  const [saidaQuantity, setSaidaQuantity] = useState("");
  const [ajusteQuantity, setAjusteQuantity] = useState("");
  const [ajusteDirection, setAjusteDirection] = useState<"aumenta" | "diminui">("diminui");

  // Leitor de código de barras: o leitor digita o código + Enter.
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanStatus, setScanStatus] = useState<{ ok: boolean; message: string } | null>(null);

  const selectedItem = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);

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
    setScanStatus({ ok: true, message: `${found.name} selecionado.` });
    setBarcodeInput("");
    // Já leva o cursor pra quantidade da aba aberta — fluxo de bipar e digitar.
    document.getElementById(`${type}_quantity`)?.focus();
  }

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
          onChange={(e) => setItemId(e.target.value)}
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
          </p>
        )}
      </div>

      <Tabs.Root
        value={type}
        onValueChange={(v) => setType(v as typeof type)}
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

        <Tabs.Content value="entrada" className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="entrada_subtype">
                Motivo da entrada *
              </label>
              <select id="entrada_subtype" name="subtype" required className="input">
                {ENTRADA_SUBTYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
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
          </div>

          {selectedItem && saidaExceedsStock && (
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
                onChange={(e) => setAjusteDirection(e.target.value as "aumenta" | "diminui")}
              >
                <option value="aumenta">Aumenta o estoque</option>
                <option value="diminui">Diminui o estoque</option>
              </select>
            </div>
          </div>

          {selectedItem && ajusteExceedsStock && (
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
          disabled={pending || (type === "saida" && saidaExceedsStock) || (type === "ajuste" && ajusteExceedsStock)}
        >
          {pending ? "Salvando..." : "Registrar movimentação"}
        </button>
      </div>
    </form>
  );
}
