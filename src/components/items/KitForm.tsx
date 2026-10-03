"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createKitAction } from "@/app/(app)/itens/kits/actions";
import { formatCurrency } from "@/lib/utils";
import type { Item } from "@/lib/types";

interface Component {
  itemId: string;
  name: string;
  salePrice: number;
  quantity: number;
}

/** Monta um kit: escolhe 2+ produtos, quantidade de cada, e o preço especial do combo. */
export function KitForm({ items }: { items: Item[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState("");
  const [kitPriceText, setKitPriceText] = useState("");
  const [components, setComponents] = useState<Component[]>([]);
  const [pickItemId, setPickItemId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const normalTotal = components.reduce((s, c) => s + c.salePrice * c.quantity, 0);
  const kitPrice = Number(kitPriceText.replace(",", ".")) || 0;
  const savings = normalTotal - kitPrice;

  function addComponent() {
    const item = items.find((i) => i.id === pickItemId);
    if (!item) return;
    setComponents((prev) => {
      const existing = prev.find((c) => c.itemId === item.id);
      if (existing) return prev.map((c) => (c.itemId === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      return [...prev, { itemId: item.id, name: item.name, salePrice: item.sale_price ?? 0, quantity: 1 }];
    });
    setPickItemId("");
  }

  function submit() {
    setError(null);
    if (!name.trim()) return setError("Informe o nome do kit.");
    if (components.length < 2) return setError("Adicione pelo menos 2 produtos.");
    if (kitPrice <= 0) return setError("Informe o preço do kit.");

    startTransition(async () => {
      const r = await createKitAction({
        name,
        kitPrice,
        items: components.map((c) => ({ itemId: c.itemId, quantity: c.quantity })),
      });
      if (!r.ok) return setError(r.error);
      setName("");
      setKitPriceText("");
      setComponents([]);
      router.refresh();
    });
  }

  return (
    <div className="card flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-foreground">Novo kit</h2>

      <div>
        <label className="label" htmlFor="kit_name">
          Nome do kit *
        </label>
        <input id="kit_name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Garmin Edge 540 + pulseira extra" />
      </div>

      <div>
        <label className="label" htmlFor="kit_pick_item">
          Produtos do kit *
        </label>
        <div className="flex gap-2">
          <select id="kit_pick_item" className="input" value={pickItemId} onChange={(e) => setPickItemId(e.target.value)}>
            <option value="">Selecione um produto...</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} {i.sale_price !== null ? `(${formatCurrency(i.sale_price)})` : ""}
              </option>
            ))}
          </select>
          <button type="button" className="btn-secondary shrink-0" disabled={!pickItemId} onClick={addComponent}>
            + Adicionar
          </button>
        </div>
      </div>

      {components.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {components.map((c) => (
            <li key={c.itemId} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="min-w-0 truncate">{c.name}</span>
              <div className="flex shrink-0 items-center gap-2">
                <input
                  type="number"
                  min={1}
                  className="input h-8 w-16 px-2 text-center"
                  value={c.quantity}
                  onChange={(e) =>
                    setComponents((prev) => prev.map((x) => (x.itemId === c.itemId ? { ...x, quantity: Math.max(1, Number(e.target.value) || 1) } : x)))
                  }
                />
                <span className="tabular-nums text-muted">{formatCurrency(c.salePrice * c.quantity)}</span>
                <button
                  type="button"
                  className="text-muted hover:text-danger"
                  onClick={() => setComponents((prev) => prev.filter((x) => x.itemId !== c.itemId))}
                  aria-label={`Remover ${c.name}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="kit_price">
            Preço do kit (R$) *
          </label>
          <input id="kit_price" inputMode="decimal" className="input" placeholder="0,00" value={kitPriceText} onChange={(e) => setKitPriceText(e.target.value)} />
        </div>
        <div className="flex flex-col justify-end text-sm">
          <span className="text-muted">
            Soma normal: <span className="tabular-nums text-foreground">{formatCurrency(normalTotal)}</span>
          </span>
          {kitPrice > 0 && (
            <span className={savings >= 0 ? "text-success" : "text-danger"}>
              {savings >= 0 ? `Economia de ${formatCurrency(savings)}` : `${formatCurrency(-savings)} acima da soma normal`}
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div>
        <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
          {pending ? "Salvando..." : "Criar kit"}
        </button>
      </div>
    </div>
  );
}
