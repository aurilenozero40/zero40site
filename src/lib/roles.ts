// Papéis da plataforma. Espelha as funções role_rank / is_manager / is_admin do schema.sql —
// o BANCO é quem impõe as regras; isto aqui só decide o que mostrar na tela.
export const ROLES = ["ceo", "admin", "gerente", "vendedor"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ceo: "CEO / Proprietário",
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function roleRank(role: string | null | undefined): number {
  switch (role) {
    case "ceo":
    case "admin":
      return 4;
    case "gerente":
      return 3;
    case "vendedor":
      return 1;
    default:
      return 0;
  }
}

/** gerente, admin e ceo */
export const isManager = (role: string | null | undefined) => roleRank(role) >= 3;

/** admin e ceo */
export const isAdmin = (role: string | null | undefined) => role === "admin" || role === "ceo";
