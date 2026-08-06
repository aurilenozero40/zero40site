import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ToastProvider } from "@/components/ui/toast-context";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: employee } = await supabase
    .from("employees")
    .select("full_name, role")
    .eq("id", user.id)
    .single();

  const isAdmin = employee?.role === "admin";

  return (
    <ToastProvider>
      <div className="flex flex-1">
        <Sidebar isAdmin={isAdmin} />
        <div className="flex flex-1 flex-col">
          <TopBar fullName={employee?.full_name ?? user.email ?? "Funcionário"} isAdmin={isAdmin} />
          <main className="flex-1 overflow-y-auto bg-surface p-4 md:p-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
