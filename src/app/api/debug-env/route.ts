import { NextResponse } from "next/server";

// Rota temporaria de diagnostico - NUNCA expõe valores secretos, so metadados.
// Remover depois de resolver o problema de env vars na Vercel.
export async function GET() {
  const vars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "TELEGRAM_BOT_TOKEN",
    "TELEGRAM_WEBHOOK_SECRET",
  ] as const;

  const report: Record<string, { present: boolean; length: number; prefix: string }> = {};

  for (const key of vars) {
    const value = process.env[key];
    report[key] = {
      present: !!value,
      length: value?.length ?? 0,
      prefix: value ? value.slice(0, 8) : "",
    };
  }

  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? null,
    vercelGitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    report,
  });
}
