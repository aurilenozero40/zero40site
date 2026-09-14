import { Logo } from "@/components/layout/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo size="lg" showSubtitle />
          <p className="mt-3 text-sm text-muted">Controle de Estoque</p>
        </div>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}
