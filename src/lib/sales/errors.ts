/** Erro do PostgREST/Supabase. */
export interface RpcError {
  code?: string;
  message: string;
  hint?: string | null;
  details?: string | null;
}

/**
 * Mensagem para o usuário a partir de um erro do banco.
 * As funções de venda já levantam a mensagem em português (com um código de máquina em `hint`),
 * então erro de regra de negócio (P0001) vai direto para a tela; o resto vira mensagem genérica.
 */
export function friendlyRpcError(error: RpcError): string {
  // função ainda não existe: o schema.sql novo não foi rodado no Supabase
  if (error.code === "PGRST202" || error.code === "42883" || /Could not find the function/i.test(error.message)) {
    return "O banco de dados ainda não foi atualizado. Rode o arquivo supabase/schema.sql no SQL Editor do Supabase.";
  }
  if (error.code === "42501") return "Você não tem permissão para fazer isso.";
  if (error.code === "P0001") return error.message;
  if (error.code === "23505") return "Já existe um registro com esses dados.";
  console.error("[rpc] erro inesperado", error);
  return "Não foi possível concluir a operação. Tente novamente.";
}
