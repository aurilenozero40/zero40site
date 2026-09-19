import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ToastProvider } from "@/components/ui/toast-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, employee } = await getSession();

  if (!user) redirect("/login");
  // Logado, mas sem cadastro de funcionário (ou inativo): tela própria, sem loop com o proxy.
  if (!employee) redirect("/sem-acesso");

  return (
    <ToastProvider>
      <div className="flex flex-1">
        <Sidebar role={employee.role} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar fullName={employee.fullName} role={employee.role} />
          <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
