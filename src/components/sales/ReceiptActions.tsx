"use client";

import Link from "next/link";
import { ArrowLeft, Download, MessageCircle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/** Botões de ação do recibo — somem na impressão (print:hidden), só aparecem na tela. */
export function ReceiptActions({
  code,
  whatsapp,
  customerName,
  total,
}: {
  code: string;
  whatsapp: string | null;
  customerName: string | null;
  total: number;
}) {
  const digits = (whatsapp ?? "").replace(/\D/g, "");
  const waPhone = digits.length === 0 ? null : digits.length <= 11 ? `55${digits}` : digits;
  const message = `Olá${customerName ? ` ${customerName}` : ""}! Segue o recibo da sua compra #${code} (${formatCurrency(total)}) na Dtudo. Qualquer dúvida é só chamar 🙂`;
  const waLink = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}` : null;

  return (
    <div className="flex items-center justify-between gap-2 print:hidden">
      <Link href={`/vendas`} className="flex items-center gap-1 text-sm text-black/60 hover:text-black">
        <ArrowLeft size={15} /> Voltar
      </Link>
      <div className="flex gap-2">
        {waLink && (
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium text-black hover:bg-black/5"
          >
            <MessageCircle size={15} /> Enviar por WhatsApp
          </a>
        )}
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/80"
        >
          <Download size={15} /> Baixar / Imprimir
        </button>
      </div>
    </div>
  );
}
