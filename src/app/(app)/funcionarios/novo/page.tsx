import { requireAdmin } from "@/lib/auth/session";
import { NewEmployeeForm } from "@/components/employees/NewEmployeeForm";

export const dynamic = "force-dynamic";

export default async function NovoFuncionarioPage() {
  await requireAdmin();

  return (
    <div className="flex max-w-md flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Novo funcionário</h1>
      <NewEmployeeForm />
    </div>
  );
}
