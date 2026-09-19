"use client";

import { useActionState } from "react";
import { EVENT_LABEL, EVENT_TYPES } from "@/lib/notifications/types";
import { saveSettings, type SettingsState } from "@/app/(app)/configuracoes/actions";

export function SettingsForm({
  discountSeller,
  discountManager,
  maxInterest,
  enabledEvents,
}: {
  discountSeller: number;
  discountManager: number;
  maxInterest: number;
  enabledEvents: string[];
}) {
  const [state, formAction, pending] = useActionState<SettingsState, FormData>(saveSettings, null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="card flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-foreground">Regras de venda</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="ds">
              Desconto máx. do vendedor (%)
            </label>
            <input id="ds" name="discount_limit_percent_vendedor" inputMode="decimal" className="input" defaultValue={discountSeller} />
            <p className="mt-1 text-xs text-muted">0 = vendedor não pode dar desconto.</p>
          </div>
          <div>
            <label className="label" htmlFor="dm">
              Desconto máx. do gerente (%)
            </label>
            <input id="dm" name="discount_limit_percent_gerente" inputMode="decimal" className="input" defaultValue={discountManager} />
          </div>
          <div>
            <label className="label" htmlFor="mi">
              Juros máximo no parcelado (%)
            </label>
            <input id="mi" name="max_interest_percent" inputMode="decimal" className="input" defaultValue={maxInterest} />
          </div>
        </div>
        <p className="text-xs text-muted">Admin e CEO não têm limite de desconto além do valor da venda. O banco confere esses limites em toda venda.</p>
      </div>

      <div className="card flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">O que o CEO recebe no Telegram</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {EVENT_TYPES.map((e) => (
            <label key={e} className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" name="events" value={e} defaultChecked={enabledEvents.includes(e)} />
              {EVENT_LABEL[e]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Alerta de estoque só dispara uma vez quando o produto vira (fica baixo ou zera), sem repetir a cada venda.</p>
      </div>

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}
      {state?.ok && <p className="text-sm text-success">Configurações salvas.</p>}

      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvando..." : "Salvar configurações"}
        </button>
      </div>
    </form>
  );
}
