"use client";

import { useActionState } from "react";
import type { Item, Supplier } from "@/lib/types";
import type { ActionState } from "@/app/(app)/itens/actions";

const UNITS = ["un", "cx", "kg", "m", "l", "par"];

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

  return (
    <form action={formAction} className="flex flex-col gap-6">
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
            className="input"
            defaultValue={item?.barcode ?? ""}
          />
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
            defaultValue={item?.manufacturer ?? ""}
          />
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
