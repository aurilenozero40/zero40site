"use client";

import { useActionState } from "react";
import { updateEmployeeTelegramChatId, type EmployeeActionState } from "@/app/(app)/funcionarios/actions";

export function EmployeeTelegramForm({ employeeId, chatId }: { employeeId: string; chatId: string | null }) {
  const [state, formAction, pending] = useActionState<EmployeeActionState, FormData>(
    updateEmployeeTelegramChatId.bind(null, employeeId),
    null
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input
        name="telegram_chat_id"
        defaultValue={chatId ?? ""}
        placeholder="ex: 123456789"
        inputMode="numeric"
        className="input h-8 w-32 py-0 text-xs"
        aria-label="Chat ID do Telegram"
      />
      <button type="submit" className="btn-secondary h-8 px-2 text-xs" disabled={pending}>
        {pending ? "..." : "Salvar"}
      </button>
      {state?.error && <span className="text-xs text-danger">{state.error}</span>}
      {state?.ok && <span className="text-xs text-success">Salvo</span>}
    </form>
  );
}
