import { CheckCircle2, XCircle } from "lucide-react";
import { requireAdmin } from "@/lib/auth/session";
import { NotificationTools, RetryButton } from "@/components/settings/NotificationTools";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { BRAND_ORDER, brandLabel, ratesFromRows } from "@/lib/sales/brands";
import { EVENT_LABEL, type EventType, type OutboxRow } from "@/lib/notifications/types";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = { pending: "Pendente", sending: "Enviando", sent: "Enviada", failed: "Falhou", skipped: "Ignorada" };
const STATUS_STYLE: Record<string, string> = {
  pending: "bg-warning/10 text-warning",
  sending: "bg-warning/10 text-warning",
  sent: "bg-success/10 text-success",
  failed: "bg-danger/10 text-danger",
  skipped: "bg-surface text-muted",
};

export default async function ConfiguracoesPage() {
  const { supabase } = await requireAdmin();

  const [{ data: settings }, { data: outbox }, { data: rateRows }] = await Promise.all([
    supabase.from("app_settings").select("key, value"),
    supabase
      .from("notification_outbox")
      .select("id, event_type, entity_type, entity_id, status, attempts, max_attempts, last_error, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("card_fee_rates").select("brand, installments, fee_percent"),
  ]);

  const setting = (key: string, fallback: unknown) => (settings ?? []).find((s) => s.key === key)?.value ?? fallback;
  const rates = ratesFromRows((rateRows ?? []) as { brand: string; installments: number; fee_percent: number }[]);
  const brands = BRAND_ORDER.filter((b) => rates[b]);
  const keys = Array.from({ length: 19 }, (_, i) => i);

  const hasToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const hasChat = Boolean(process.env.TELEGRAM_CEO_CHAT_ID);
  const rows = (outbox as unknown as (OutboxRow & { entity_type: string })[]) ?? [];
  const failed = rows.filter((r) => r.status === "failed").length;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Configurações</h1>

      <div className="card flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Telegram do CEO</h2>
            <p className="text-xs text-muted">O Telegram só avisa: vendas e movimentações são feitas aqui na plataforma.</p>
          </div>
        </div>

        <ul className="flex flex-col gap-1.5 text-sm">
          <Status ok={hasToken} label="TELEGRAM_BOT_TOKEN" hint="token do bot (criado no @BotFather)" />
          <Status ok={hasChat} label="TELEGRAM_CEO_CHAT_ID" hint="chat que recebe os avisos (mande /start ao bot para descobrir o número)" />
          <Status ok={Boolean(process.env.CRON_SECRET)} label="CRON_SECRET" hint="protege o reenvio automático das falhas" optional />
        </ul>

        {!(hasToken && hasChat) && (
          <div className="rounded-md bg-background p-3 text-xs text-muted">
            <p className="mb-1 font-medium text-foreground">Como configurar</p>
            <ol className="list-inside list-decimal space-y-0.5">
              <li>No Telegram, fale com o <strong>@BotFather</strong>, crie um bot e copie o token.</li>
              <li>Coloque o token em <code>TELEGRAM_BOT_TOKEN</code> (Vercel → Environment Variables e no <code>.env.local</code>).</li>
              <li>Abra o bot e mande <code>/start</code>. Ele responde o seu <strong>chat ID</strong> (se o webhook estiver registrado).</li>
              <li>Coloque esse número em <code>TELEGRAM_CEO_CHAT_ID</code> e reinicie/redeploy.</li>
            </ol>
          </div>
        )}

        <NotificationTools />
      </div>

      <SettingsForm
        discountSeller={Number(setting("discount_limit_percent_vendedor", 0))}
        discountManager={Number(setting("discount_limit_percent_gerente", 100))}
        maxInterest={Number(setting("max_interest_percent", 50))}
        enabledEvents={(setting("notify_events", []) as string[]) ?? []}
      />

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">Fila de notificações</h2>
          {failed > 0 && <span className="text-xs font-medium text-danger">{failed} com falha</span>}
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Quando</th>
                <th className="px-4 py-3">Evento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tentativas</th>
                <th className="px-4 py-3">Erro</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((n) => (
                <tr key={n.id} className="border-b border-border align-top last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDate(n.created_at, true)}</td>
                  <td className="px-4 py-3">{EVENT_LABEL[n.event_type as EventType] ?? n.event_type}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[n.status] ?? ""}`}>{STATUS_LABEL[n.status] ?? n.status}</span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted">
                    {n.attempts}/{n.max_attempts}
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-xs text-muted">{n.last_error ?? "—"}</td>
                  <td className="px-4 py-3">{(n.status === "failed" || n.status === "pending") && <RetryButton id={n.id} />}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted">
                    Nenhuma notificação ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Taxas da operadora de cartão</h2>
          <p className="text-xs text-muted">O que a operadora cobra da loja (não é o juros do cliente). Usadas no líquido de cada venda. Para alterar, edite a tabela <code>card_fee_rates</code> no Supabase.</p>
        </div>
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Taxas finais</th>
                {brands.map((b) => (
                  <th key={b} className="px-4 py-3 text-right">
                    {brandLabel(b)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-b border-border last:border-0">
                  <td className="px-4 py-1.5 font-medium text-foreground">{k === 0 ? "Débito" : `${k}x`}</td>
                  {brands.map((b) => (
                    <td key={b} className="px-4 py-1.5 text-right tabular-nums text-muted">
                      {rates[b]?.[k] === undefined ? "—" : `${rates[b][k].toLocaleString("pt-BR", { minimumFractionDigits: 2 })}%`}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Status({ ok, label, hint, optional }: { ok: boolean; label: string; hint: string; optional?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      {ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" /> : <XCircle size={16} className={`mt-0.5 shrink-0 ${optional ? "text-muted" : "text-danger"}`} />}
      <span>
        <code className="text-xs">{label}</code> <span className="text-xs text-muted">— {ok ? "configurado" : optional ? `não configurado (opcional): ${hint}` : `faltando: ${hint}`}</span>
      </span>
    </li>
  );
}
