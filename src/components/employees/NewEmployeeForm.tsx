"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, ROLE_LABEL, isRole, type Role } from "@/lib/roles";

export function NewEmployeeForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("vendedor");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name: fullName, email, password, role }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Erro ao criar funcionário");
      setLoading(false);
      return;
    }

    router.push("/funcionarios");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="card flex flex-col gap-4">
      <div>
        <label className="label" htmlFor="full_name">
          Nome completo
        </label>
        <input
          id="full_name"
          required
          className="input"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="email">
          E-mail
        </label>
        <input
          id="email"
          type="email"
          required
          className="input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="password">
          Senha temporária
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={6}
          className="input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor="role">
          Papel
        </label>
        <select
          id="role"
          className="input"
          value={role}
          onChange={(e) => isRole(e.target.value) && setRole(e.target.value)}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? "Criando..." : "Criar funcionário"}
      </button>
    </form>
  );
}
