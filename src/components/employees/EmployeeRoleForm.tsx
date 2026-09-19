"use client";

import { useActionState } from "react";
import { ROLES, ROLE_LABEL } from "@/lib/roles";
import { updateEmployeeRole, type EmployeeActionState } from "@/app/(app)/funcionarios/actions";

export function EmployeeRoleForm({ employeeId, role }: { employeeId: string; role: string }) {
  const [state, formAction, pending] = useActionState<EmployeeActionState, FormData>(
    updateEmployeeRole.bind(null, employeeId),
    null
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <select name="role" defaultValue={role} className="input h-8 w-44 py-0 text-xs" aria-label="Papel">
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      <button type="submit" className="btn-secondary h-8 px-2 text-xs" disabled={pending}>
        {pending ? "..." : "Salvar"}
      </button>
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
      {state?.ok && <span className="text-xs text-success">Salvo</span>}
    </form>
  );
}
