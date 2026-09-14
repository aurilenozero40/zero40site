"use client";

import { useActionState, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { cn, formatCurrency, formatQuantity } from "@/lib/utils";
import { CARD_BRANDS, CREDIT_INSTALLMENTS, getCardFeeRate } from "@/lib/cardFees";
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

  // Calculadora de taxa de cartão — só usada quando paymentMethod === "cartao".
  // NUNCA chutar valor default aqui (nem "1") — quantidade/valor ficam vazios
  // até o funcionário preencher de verdade; dado real, não inventado.
  const [saidaQuantity, setSaidaQuantity] = useState("");
  const [saidaUnitValue, setSaidaUnitValue] = useState("");
  const [cardBrand, setCardBrand] = useState("");
  const [cardMode, setCardMode] = useState<"debito" | "credito">("credito");
  const [installments, setInstallments] = useState(1);
  const [ajusteQuantity, setAjusteQuantity] = useState("");
  const [ajusteDirection, setAjusteDirection] = useState<"aumenta" | "diminui">("diminui");

  const selectedItem = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);

  // Aviso em tempo real — o item já vem com a quantidade em estoque no
  // carregamento da página; a trava de verdade (contra corrida entre duas
  // pessoas vendendo/ajustando ao mesmo tempo) é no servidor + no banco.
  const saidaExceedsStock =
    !!selectedItem && saidaQuantity.trim() !== "" && Number(saidaQuantity) > selectedItem.quantity;
  const ajusteExceedsStock =
    !!selectedItem &&
    ajusteDirection === "diminui" &&
    ajusteQuantity.trim() !== "" &&
    Number(ajusteQuantity) > selectedItem.quantity;

  const cardTotalValue = (Number(saidaQuantity) || 0) * (Number(saidaUnitValue) || 0);
  const cardHasRealTotal = saidaQuantity.trim() !== "" && saidaUnitValue.trim() !== "" && cardTotalValue > 0;
  const cardFeeRate = cardBrand
    ? getCardFeeRate(cardBrand, cardMode === "debito", installments)
    : null;
  const cardFeeValue = cardFeeRate !== null ? (cardTotalValue * cardFeeRate) / 100 : 0;
  const cardNetValue = cardTotalValue - cardFeeValue;
  const cardBlocked = paymentMethod === "cartao" && !!cardBrand && cardFeeRate === null;

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
                value={saidaQuantity}
                onChange={(e) => setSaidaQuantity(e.target.value)}
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
                value={saidaUnitValue}
                onChange={(e) => setSaidaUnitValue(e.target.value)}
              />
            </div>
          </div>

          {selectedItem && saidaExceedsStock && (
            <p className="text-sm font-medium text-danger">
              Estoque insuficiente: só tem {formatQuantity(selectedItem.quantity, selectedItem.unit)}{" "}
              disponível.
            </p>
          )}

          {saidaSubtype === "venda" && (
            <div className="flex flex-col gap-4">
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
                    <label className="label" htmlFor="card_brand">
                      Bandeira do cartão *
                    </label>
                    <select
                      id="card_brand"
                      name="card_brand"
                      required
                      className="input"
                      value={cardBrand}
                      onChange={(e) => setCardBrand(e.target.value)}
                    >
                      <option value="" disabled>
                        Selecione...
                      </option>
                      {CARD_BRANDS.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {paymentMethod === "cartao" && (
                <div className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
                  <div className="flex gap-1 rounded-md bg-surface p-1 w-fit">
                    {(["debito", "credito"] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCardMode(mode)}
                        className={cn(
                          "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors",
                          cardMode === mode
                            ? "bg-background text-foreground shadow-sm"
                            : "text-muted hover:text-foreground"
                        )}
                      >
                        {mode === "debito" ? "Débito" : "Crédito"}
                      </button>
                    ))}
                  </div>

                  {/* installments manda pro banco 1 mesmo no débito — o
                      banco não distingue débito/crédito, só guarda parcela;
                      quem carrega essa diferença é fee_percent/fee_value. */}
                  <input type="hidden" name="installments" value={cardMode === "debito" ? 1 : installments} />

                  {cardMode === "credito" && (
                    <div className="max-w-[160px]">
                      <label className="label" htmlFor="installments_select">
                        Parcelas
                      </label>
                      <select
                        id="installments_select"
                        className="input"
                        value={installments}
                        onChange={(e) => setInstallments(Number(e.target.value))}
                      >
                        {CREDIT_INSTALLMENTS.map((n) => (
                          <option key={n} value={n}>
                            {n}x
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <input type="hidden" name="fee_percent" value={cardFeeRate ?? ""} />
                  <input type="hidden" name="fee_value" value={cardFeeValue.toFixed(2)} />

                  {cardBrand && cardFeeRate === null && (
                    <p className="text-xs text-warning">
                      Essa bandeira não tem taxa de débito cadastrada — escolha &quot;Crédito&quot; ou outra bandeira.
                    </p>
                  )}

                  {cardBrand && cardFeeRate !== null && !cardHasRealTotal && (
                    <p className="text-xs text-muted">
                      Preencha quantidade e valor de saída pra calcular a taxa.
                    </p>
                  )}

                  {cardBrand && cardFeeRate !== null && cardHasRealTotal && (
                    <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Total da venda</p>
                        <p className="font-medium text-foreground">{formatCurrency(cardTotalValue)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Taxa</p>
                        <p className="font-medium text-foreground">
                          {cardFeeRate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Valor da taxa</p>
                        <p className="font-medium text-danger">{formatCurrency(cardFeeValue)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Você recebe</p>
                        <p className="font-semibold text-success">{formatCurrency(cardNetValue)}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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
          disabled={
            pending ||
            cardBlocked ||
            (type === "saida" && saidaExceedsStock) ||
            (type === "ajuste" && ajusteExceedsStock)
          }
        >
          {pending ? "Salvando..." : "Registrar movimentação"}
        </button>
      </div>
    </form>
  );
}
