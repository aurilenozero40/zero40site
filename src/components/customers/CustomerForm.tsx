"use client";

import { useActionState } from "react";
import type { Customer } from "@/lib/types";
import { formatDocument, formatPhone } from "@/lib/documents";
import type { ActionState } from "@/app/(app)/clientes/actions";

export function CustomerForm({
  action,
  customer,
}: {
  action: (prevState: ActionState, formData: FormData) => Promise<ActionState>;
  customer?: Customer;
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <div className="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="name">
            Nome *
          </label>
          <input id="name" name="name" required className="input" defaultValue={customer?.name} autoFocus={!customer} />
        </div>
        <div>
          <label className="label" htmlFor="document">
            CPF / CNPJ
          </label>
          <input id="document" name="document" inputMode="numeric" className="input" defaultValue={formatDocument(customer?.document)} placeholder="Só números ou formatado" />
        </div>
        <div>
          <label className="label" htmlFor="email">
            E-mail
          </label>
          <input id="email" name="email" type="email" className="input" defaultValue={customer?.email ?? ""} />
        </div>
        <div>
          <label className="label" htmlFor="phone">
            Telefone
          </label>
          <input id="phone" name="phone" inputMode="tel" className="input" defaultValue={formatPhone(customer?.phone)} placeholder="(85) 3333-4444" />
        </div>
        <div>
          <label className="label" htmlFor="whatsapp">
            WhatsApp
          </label>
          <input id="whatsapp" name="whatsapp" inputMode="tel" className="input" defaultValue={formatPhone(customer?.whatsapp)} placeholder="(85) 99999-0000" />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="address">
            Endereço
          </label>
          <input id="address" name="address" className="input" defaultValue={customer?.address ?? ""} />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="notes">
            Observações
          </label>
          <textarea id="notes" name="notes" rows={3} className="input" defaultValue={customer?.notes ?? ""} />
        </div>
      </div>

      {state?.error && <p className="text-sm text-danger">{state.error}</p>}

      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Salvando..." : customer ? "Salvar alterações" : "Cadastrar cliente"}
        </button>
      </div>
    </form>
  );
}
