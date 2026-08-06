"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

async function assertAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Não autenticado");

  const { data: caller } = await supabase
    .from("employees")
    .select("role")
    .eq("id", user.id)
    .single();

  if (caller?.role !== "admin") throw new Error("Apenas administradores podem gerenciar funcionários");

  return supabase;
}

export async function updateTelegramChatId(employeeId: string, formData: FormData) {
  const supabase = await assertAdmin();
  const chatId = String(formData.get("telegram_chat_id") ?? "").trim();

  await supabase
    .from("employees")
    .update({ telegram_chat_id: chatId === "" ? null : chatId })
    .eq("id", employeeId);

  revalidatePath("/funcionarios");
}

export async function toggleEmployeeActive(employeeId: string, active: boolean) {
  const supabase = await assertAdmin();
  await supabase.from("employees").update({ active }).eq("id", employeeId);
  revalidatePath("/funcionarios");
}
