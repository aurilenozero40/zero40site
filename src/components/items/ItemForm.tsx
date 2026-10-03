"use client";

import { useActionState, useState } from "react";
import { X } from "lucide-react";
import { isValidGtin } from "@/lib/barcode";
import type { Item, Supplier } from "@/lib/types";
import type { ActionState } from "@/app/(app)/itens/actions";

const UNITS = ["un", "cx", "kg", "m", "l", "par"];
const BRAND_SUGGESTIONS = ["Garmin", "Coros", "Shokz", "Wahoo"];

export function ItemForm({
  action,
  item,
  suppliers,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  item?: Item;
  suppliers: Supplier[];
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);
  const [barcode, setBarcode] = useState(item?.barcode ?? "");
  const [trackSerial, setTrackSerial] = useState(item?.track_serial ?? false);
  const [initialSerials, setInitialSerials] = useState<string[]>([]);
  const [serialInput, setSerialInput] = useState("");

  // Só avisa (não bloqueia): códigos internos/alfanuméricos são válidos, mas um
  // código numérico de 8/12/13/14 dígitos com verificador errado é quase
  // sempre erro de digitação.
  const trimmedBarcode = barcode.trim();
  const barcodeLooksMistyped =
    /^\d+$/.test(trimmedBarcode) &&
    [8, 12, 13, 14].includes(trimmedBarcode.length) &&
    !isValidGtin(trimmedBarcode);

  return (
    <form
      action={formAction}
      // O leitor de código de barras "digita" o código e manda Enter — sem isso, o Enter
      // enviava o formulário na hora (produto salvo pela metade, faltando os outros campos).
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (e.key === "Enter" && (tag === "INPUT" || tag === "SELECT")) {
          e.preventDefault();
        }
      }}
      className="flex flex-col gap-6"
    >
      <div className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">
            Nome *
          </label>
          <input id="name" name="name" required className="input" defaultValue={item?.name} />
        </div>

        <div>
          <label className="label" htmlFor="sku">
            SKU
          </label>
          <input id="sku" name="sku" className="input" defaultValue={item?.sku ?? ""} />
        </div>

        <div>
          <label className="label" htmlFor="barcode">
            Código de barras
          </label>
          <input
            id="barcode"
            name="barcode"
            inputMode="numeric"
            autoComplete="off"
            className="input font-mono"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
          />
          {barcodeLooksMistyped && (
            <p className="mt-1 text-xs text-warning">
              O dígito verificador desse código não confere — pode ter erro de digitação. Confira
              com a etiqueta do produto.
            </p>
          )}
        </div>

        <div>
          <label className="label" htmlFor="category">
            Categoria
          </label>
          <input
            id="category"
            name="category"
            className="input"
            defaultValue={item?.category ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor="subcategory">
            Subcategoria
          </label>
          <input
            id="subcategory"
            name="subcategory"
            className="input"
            defaultValue={item?.subcategory ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor="manufacturer">
            Fabricante/Marca
          </label>
          <input
            id="manufacturer"
            name="manufacturer"
            className="input"
            list="brand_suggestions"
            defaultValue={item?.manufacturer ?? ""}
          />
          <datalist id="brand_suggestions">
            {BRAND_SUGGESTIONS.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>

        <div>
          <label className="label" htmlFor="unit">
            Unidade de medida
          </label>
          <select id="unit" name="unit" className="input" defaultValue={item?.unit ?? "un"}>
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="condition">
            Condição
          </label>
          <select id="condition" name="condition" className="input" defaultValue={item?.condition ?? "novo"}>
            <option value="novo">Novo</option>
            <option value="seminovo">Seminovo</option>
          </select>
          <p className="mt-1 text-xs text-muted">
            Produtos recebidos como entrada numa venda já entram como seminovo automaticamente.
          </p>
        </div>

      </div>

      <div className="card flex flex-col gap-2">
        <input type="hidden" name="track_serial" value={trackSerial ? "on" : ""} />
        <p className="text-sm font-medium text-foreground">Esse produto tem número de série (IMEI)?</p>
        <p className="text-xs text-muted">
          Cada GPS/relógio tem um número de série próprio? Se sim, na entrada de estoque e na venda vai aparecer um
          campo extra pra bipar esse número, unidade por unidade — além do código de barras do produto.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTrackSerial(true)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              trackSerial ? "border-accent bg-accent/15 text-foreground" : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            Sim, tem número de série
          </button>
          <button
            type="button"
            onClick={() => setTrackSerial(false)}
            className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${
              !trackSerial ? "border-accent bg-accent/15 text-foreground" : "border-border bg-background text-muted hover:text-foreground"
            }`}
          >
            Não
          </button>
        </div>
        {item && !item.track_serial && trackSerial && item.quantity > 0 && (
          <p className="text-xs font-medium text-warning">
            Esse produto já tem {item.quantity} em estoque sem número de série cadastrado. Depois de salvar, registre uma
            nova entrada bipando os seriais das unidades que já estão na loja — senão elas não poderão ser vendidas.
          </p>
        )}

        {!item && trackSerial && (
          <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
            <input type="hidden" name="initial_serials" value={JSON.stringify(initialSerials)} />
            <label className="label" htmlFor="initial_serial_input">
              Número de série (opcional — já dá entrada no estoque)
            </label>
            <div className="flex gap-2">
              <input
                id="initial_serial_input"
                autoComplete="off"
                className="input flex-1"
                placeholder="Bipe ou digite o número de série e aperte Enter"
                value={serialInput}
                onChange={(e) => setSerialInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const s = serialInput.trim();
                    if (!s) return;
                    if (initialSerials.includes(s)) return setSerialInput("");
                    setInitialSerials((prev) => [...prev, s]);
                    setSerialInput("");
                  }
                }}
              />
            </div>
            <p className="text-xs text-muted">
              Se já tiver a(s) unidade(s) em mãos, bipe o(s) serial(is) aqui — o produto já nasce com essas unidades em
              estoque. Se preferir, deixe em branco e dê entrada depois em Movimentações.
            </p>
            {initialSerials.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {initialSerials.map((s) => (
                  <li key={s} className="flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 font-mono text-xs text-foreground">
                    {s}
                    <button
                      type="button"
                      onClick={() => setInitialSerials((prev) => prev.filter((x) => x !== s))}
                      aria-label={`Remover ${s}`}
                      className="text-muted hover:text-danger"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <label className="label" htmlFor="description">
          Descrição
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          className="input"
          defaultValue={item?.description ?? ""}
          placeholder="Detalhes do produto (cor, tamanho, garantia...)"
        />
      </div>

      <div className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <h2 className="text-sm font-semibold text-foreground sm:col-span-2">Preços e estoque</h2>

        <div>
          <label className="label" htmlFor="cost_price">
            Preço de custo (R$)
          </label>
          <input
            id="cost_price"
            name="cost_price"
            type="number"
            step="0.01"
            min="0"
            className="input"
            defaultValue={item?.cost_price ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor="sale_price">
            Preço de venda (R$)
          </label>
          <input
            id="sale_price"
            name="sale_price"
            type="number"
            step="0.01"
            min="0"
            className="input"
            defaultValue={item?.sale_price ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor="min_stock">
            Estoque mínimo *
          </label>
          <input
            id="min_stock"
            name="min_stock"
            type="number"
            step="0.001"
            min="0"
            required
            className="input"
            defaultValue={item?.min_stock ?? 0}
          />
          <p className="mt-1 text-xs text-muted">Abaixo disso, o item entra no alerta de estoque baixo.</p>
        </div>

        <div>
          <label className="label" htmlFor="reorder_point">
            Ponto de pedido
          </label>
          <input
            id="reorder_point"
            name="reorder_point"
            type="number"
            step="0.001"
            min="0"
            className="input"
            defaultValue={item?.reorder_point ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor="max_stock">
            Estoque máximo
          </label>
          <input
            id="max_stock"
            name="max_stock"
            type="number"
            step="0.001"
            min="0"
            className="input"
            defaultValue={item?.max_stock ?? ""}
          />
        </div>

        <div>
          <label className="label" htmlFor="warranty_months">
            Garantia (meses)
          </label>
          <input
            id="warranty_months"
            name="warranty_months"
            type="number"
            step="1"
            min="1"
            className="input"
            defaultValue={item?.warranty_months ?? ""}
            placeholder="Ex: 12"
          />
          <p className="mt-1 text-xs text-muted">Em branco = sem garantia controlada pelo sistema.</p>
        </div>

        <div>
          <label className="label" htmlFor="location">
            Localização
          </label>
          <input
            id="location"
            name="location"
            className="input"
            defaultValue={item?.location ?? "principal"}
          />
        </div>

        {suppliers.length > 0 && (
          <div>
            <label className="label" htmlFor="supplier_id">
              Fornecedor
            </label>
            <select
              id="supplier_id"
              name="supplier_id"
              className="input"
              defaultValue={item?.supplier_id ?? ""}
            >
              <option value="">-</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}

      <div className="flex gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvando..." : item ? "Salvar alterações" : "Criar item"}
        </button>
      </div>
    </form>
  );
}
