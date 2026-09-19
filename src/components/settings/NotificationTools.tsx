"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Send } from "lucide-react";
import {
  processQueueNowAction,
  retryNotificationAction,
  sendTestNotificationAction,
  type ToolResult,
} from "@/app/(app)/configuracoes/actions";
import { cn } from "@/lib/utils";

export function NotificationTools() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ToolResult | null>(null);

  const run = (fn: () => Promise<ToolResult>) =>
    startTransition(async () => {
      setResult(await fn());
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(sendTestNotificationAction)}>
          <Send size={15} /> Enviar mensagem de teste
        </button>
        <button type="button" className="btn-secondary" disabled={pending} onClick={() => run(processQueueNowAction)}>
          <RefreshCw size={15} /> Enviar fila agora
        </button>
      </div>
      {result && (
        <p role="status" className={cn("text-sm", result.ok ? "text-success" : "text-danger")}>
          {result.message}
        </p>
      )}
    </div>
  );
}

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className="btn-secondary h-7 px-2 text-xs"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await retryNotificationAction(id);
          router.refresh();
        })
      }
    >
      {pending ? "..." : "Reenviar"}
    </button>
  );
}
