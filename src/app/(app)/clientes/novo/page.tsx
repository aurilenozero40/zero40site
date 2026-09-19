import { requireEmployee } from "@/lib/auth/session";
import { CustomerForm } from "@/components/customers/CustomerForm";
import { createCustomer } from "../actions";

export default async function NovoClientePage() {
  await requireEmployee();
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">Novo cliente</h1>
      <CustomerForm action={createCustomer} />
    </div>
  );
}
