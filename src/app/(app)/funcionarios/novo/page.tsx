import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NewEmployeeForm } from "@/components/employees/NewEmployeeForm";

export default async function NovoFuncionarioPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: caller } = await supabase
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .single();

  if (caller?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="flex max-w-md flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Novo funcionário</h1>
      <NewEmployeeForm />
    </div>
  );
}
