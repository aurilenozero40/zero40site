"use client";

import { useActionState, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { cn, formatQuantity } from "@/lib/utils";
import type { Item } from "@/lib/types";
import type { ActionState } from "@/app/(app)/movimentacoes/actions";

const ENTRADA_SUBTYPES = [
  { value: "compra", label: "Compra" },
  { value: "devolucao", label: "Devolução" },
  { value: "transferencia", label: "Transferência" },
];

const SAIDA_SUBTYPES = [
  { value: "uso", label: "Uso" },
  { value: "perda", label: "Perda" },
  { value: "venda", label: "Venda" },
  { value: "emprestimo", label: "Empréstimo" },
];

const PAYMENT_METHODS = [
  { value: "a_vista", label: "À vista" },
  { value: "pix", label: "Pix" },
  { value: "cartao", label: "Cartão" },
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
  const [saidaSubtype, setSaidaSubtype] = useState("venda");
  const [paymentMethod, setPaymentMethod] = useState("");

  const selectedItem = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="card flex flex-col gap-2">
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
        <Tabs.List className="flex gap-1 rounded-md bg-surface p-1">
          {(["entrada", "saida", "ajuste"] as const).map((t) => (
            <Tabs.Trigger
              key={t}
              value={t}
              className={cn(
                "flex-1 rounded-md px-3 py-2 text-sm font-medium capitalize transition-colors",
                type === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {t}
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
              />
            </div>
            <div>
              <label className="label" htmlFor="saida_unit_value">
                Valor de saída (R$/un)
              </label>
              <input
                id="saida_unit_value"
                name="unit_value"
                type="number"
                step="0.01"
                min="0"
                className="input"
              />
            </div>
          </div>

          {saidaSubtype === "venda" && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="payment_method">
                  Forma de pagamento
                </label>
                <select
                  id="payment_method"
                  name="payment_method"
                  className="input"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="">-</option>
                  {PAYMENT_METHODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              {paymentMethod === "cartao" && (
                <div>
                  <label className="label" htmlFor="installments">
                    Parcelas
                  </label>
                  <input
                    id="installments"
                    name="installments"
                    type="number"
                    min="1"
                    max="24"
                    required
                    className="input"
                    defaultValue={1}
                  />
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label" htmlFor="saida_reason">
              Observação
            </label>
            <input id="saida_reason" name="reason" className="input" />
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
              />
            </div>
            <div>
              <label className="label" htmlFor="direction">
                Direção *
              </label>
              <select id="direction" name="direction" required className="input" defaultValue="diminui">
                <option value="aumenta">Aumenta o estoque</option>
                <option value="diminui">Diminui o estoque</option>
              </select>
            </div>
          </div>
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
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvando..." : "Registrar movimentação"}
        </button>
      </div>
    </form>
  );
}
