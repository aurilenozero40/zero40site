"use client";

import { useActionState } from "react";
import { updateEmployeeName, type EmployeeActionState } from "@/app/(app)/funcionarios/actions";

export function EmployeeNameForm({ employeeId, name, isMe }: { employeeId: string; name: string; isMe?: boolean }) {
  const [state, formAction, pending] = useActionState<EmployeeActionState, FormData>(updateEmployeeName.bind(null, employeeId), null);
  const looksLikeEmail = name.includes("@");

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input
        name="full_name"
        defaultValue={name}
        aria-label="Nome de exibição"
        className={`input h-8 w-44 py-0 text-sm font-medium ${looksLikeEmail ? "border-warning" : ""}`}
      />
      <button type="submit" className="btn-secondary h-8 px-2 text-xs" disabled={pending}>
        {pending ? "..." : "Salvar"}
      </button>
      {isMe && <span className="text-xs text-muted">(você)</span>}
      {looksLikeEmail && !state?.ok && <span className="text-xs text-warning">nome está como e-mail — corrija</span>}
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
      {state?.ok && <span className="text-xs text-success">Salvo</span>}
    </form>
  );
}
