"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { movementSchema } from "@/lib/validations";

export type ActionState = { error?: string } | null;

function parseFormData(formData: FormData) {
  const type = formData.get("type");
  const base = {
    type,
    item_id: formData.get("item_id"),
    quantity: formData.get("quantity"),
  };

  if (type === "entrada") {
    return {
      ...base,
      subtype: formData.get("subtype"),
      unit_value: formData.get("unit_value") === "" ? "" : Number(formData.get("unit_value")),
      reason: formData.get("reason"),
    };
  }

  if (type === "saida") {
    // formData.get() retorna `null` (não `""`) quando o campo nem existe no
    // formulário — "Parcelas" só é renderizado com forma de pagamento
    // "cartão". Tratar só "" como vazio deixava passar `Number(null) === 0`,
    // que quebrava a validação (quantidade mínima de parcela é 1) mesmo
    // quando não tinha cartão nenhum envolvido.
    // "Parcelas", "Bandeira", "Taxa" só existem no DOM quando forma de
    // pagamento é "cartão" — nesses casos formData.get() retorna `null` (não
    // `""`), então cada um precisa desse mesmo cuidado antes de virar Number.
    const installmentsRaw = formData.get("installments");
    const cardBrandRaw = formData.get("card_brand");
    const feePercentRaw = formData.get("fee_percent");
    const feeValueRaw = formData.get("fee_value");
    return {
      ...base,
      subtype: formData.get("subtype"),
      unit_value: formData.get("unit_value") === "" ? "" : Number(formData.get("unit_value")),
      payment_method: formData.get("payment_method") || null,
      installments:
        installmentsRaw === null || installmentsRaw === "" ? null : Number(installmentsRaw),
      card_brand: cardBrandRaw === null ? "" : cardBrandRaw,
      fee_percent: feePercentRaw === null || feePercentRaw === "" ? "" : Number(feePercentRaw),
      fee_value: feeValueRaw === null || feeValueRaw === "" ? "" : Number(feeValueRaw),
      reason: formData.get("reason"),
    };
  }

  return {
    ...base,
    adjustment_increases_stock: formData.get("direction") === "aumenta",
    reason: formData.get("reason"),
  };
}

export async function createMovement(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = movementSchema.safeParse(parseFormData(formData));

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos" };
  }

  // Perda tem que vir com motivo escrito — é dado que sustenta auditoria
  // (por que sumiu/quebrou), não dá pra deixar em branco.
  if (parsed.data.type === "saida" && parsed.data.subtype === "perda" && !parsed.data.reason) {
    return { error: "Motivo da perda é obrigatório" };
  }

  // Espelha a constraint cartao_requires_card_brand do banco — valida aqui
  // pra dar um erro em português em vez do erro cru do Postgres.
  if (
    parsed.data.type === "saida" &&
    parsed.data.payment_method === "cartao" &&
    !parsed.data.card_brand
  ) {
    return { error: "Bandeira do cartão é obrigatória para pagamento em cartão" };
  }

  if (
    parsed.data.type === "saida" &&
    parsed.data.payment_method === "cartao" &&
    parsed.data.fee_percent === null
  ) {
    return {
      error:
        "Não tem taxa cadastrada pra essa bandeira nessa modalidade (ex: débito em bandeira sem débito). Escolha outra opção.",
    };
  }

  const supabase = await createClient();

  // Confere estoque disponível ANTES de tentar inserir — busca o valor mais
  // atual possível (protege contra outra movimentação ter acontecido entre a
  // página carregar e esse submit). O banco também tem uma constraint contra
  // quantity negativo (items_quantity_not_negative) como rede de segurança
  // final, caso esse check aqui seja contornado por algum outro caminho.
  const isStockDecrease =
    parsed.data.type === "saida" ||
    (parsed.data.type === "ajuste" && !parsed.data.adjustment_increases_stock);

  if (isStockDecrease) {
    const { data: currentItem } = await supabase
      .from("items")
      .select("name, quantity, unit")
      .eq("id", parsed.data.item_id)
      .single();

    if (currentItem && currentItem.quantity - parsed.data.quantity < 0) {
      return {
        error: `Estoque insuficiente: ${currentItem.name} tem só ${currentItem.quantity} ${currentItem.unit} disponível, e essa movimentação tiraria ${parsed.data.quantity} ${currentItem.unit}.`,
      };
    }
  }

  const { error } = await supabase.from("movements").insert({
    ...parsed.data,
    source_channel: "web",
  });

  if (error) {
    if (error.message.includes("items_quantity_not_negative")) {
      return {
        error: "Essa movimentação deixaria o estoque negativo. Confira a quantidade disponível do item.",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/movimentacoes");
  revalidatePath("/itens");
  revalidatePath(`/itens/${parsed.data.item_id}`);
  revalidatePath("/dashboard");
  revalidatePath("/relatorios/entradas");
  revalidatePath("/relatorios/saidas");
  redirect("/movimentacoes");
}
