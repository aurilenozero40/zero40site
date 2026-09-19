import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Logo } from "@/components/layout/Logo";
import { SignOutButton } from "./SignOutButton";

export const dynamic = "force-dynamic";

export default async function SemAcessoPage() {
  const { user, employee } = await getSession();
  if (!user) redirect("/login");
  if (employee) redirect("/dashboard");

  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" showSubtitle />
        </div>
        <div className="card flex flex-col gap-4 text-center">
          <h1 className="text-lg font-semibold text-foreground">Acesso não liberado</h1>
          <p className="text-sm text-muted">
            Sua conta ({user.email}) está ativa no login, mas ainda não tem acesso à plataforma — ou foi desativada.
            Peça a um administrador para liberar seu acesso.
          </p>
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
