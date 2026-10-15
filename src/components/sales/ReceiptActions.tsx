"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileDown, MessageCircle, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

/** Monta o PDF do recibo a partir do elemento #recibo-content (captura visual, não o print do navegador). */
async function buildReceiptPdf(code: string) {
  const el = document.getElementById("recibo-content");
  if (!el) throw new Error("Recibo não encontrado na página.");

  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([import("jspdf"), import("html2canvas-pro")]);

  const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "px", format: [canvas.width, canvas.height] });
  pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
  const blob = pdf.output("blob") as Blob;
  return { blob, filename: `recibo-${code}.pdf` };
}

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
  const [busy, setBusy] = useState<"download" | "share" | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const digits = (whatsapp ?? "").replace(/\D/g, "");
  const waPhone = digits.length === 0 ? null : digits.length <= 11 ? `55${digits}` : digits;
  const message = `Olá${customerName ? ` ${customerName}` : ""}! Segue o recibo da sua compra #${code} (${formatCurrency(total)}) na Dtudo. Qualquer dúvida é só chamar 🙂`;
  const waLink = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}` : null;

  async function handleDownload() {
    setBusy("download");
    setHint(null);
    try {
      const { blob, filename } = await buildReceiptPdf(code);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setHint("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    setBusy("share");
    setHint(null);
    try {
      const { blob, filename } = await buildReceiptPdf(code);
      const file = new File([blob], filename, { type: "application/pdf" });

      // Compartilhamento nativo (abre o seletor do celular, incluindo WhatsApp) anexa o PDF de verdade.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Recibo #${code}`, text: message });
        return;
      }

      // Sem suporte a compartilhar arquivo (ex: desktop): baixa o PDF e abre o WhatsApp só com a mensagem —
      // o cliente anexa o arquivo baixado manualmente (o WhatsApp Web não aceita anexo por link).
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (waLink) window.open(waLink, "_blank", "noopener,noreferrer");
      setHint("PDF baixado. No WhatsApp que abriu, anexe o arquivo baixado na conversa.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setHint("Não foi possível compartilhar. Tente baixar o PDF.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <Link href={`/vendas`} className="flex items-center gap-1 text-sm text-black/60 hover:text-black">
          <ArrowLeft size={15} /> Voltar
        </Link>
        <div className="flex flex-wrap justify-end gap-2">
          {waLink && (
            <button
              type="button"
              onClick={handleShare}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium text-black hover:bg-black/5 disabled:opacity-50"
            >
              <MessageCircle size={15} /> {busy === "share" ? "Gerando PDF..." : "Enviar por WhatsApp"}
            </button>
          )}
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy !== null}
            className="flex items-center gap-1.5 rounded-md border border-black/20 px-3 py-1.5 text-sm font-medium text-black hover:bg-black/5 disabled:opacity-50"
          >
            <FileDown size={15} /> {busy === "download" ? "Gerando PDF..." : "Baixar PDF"}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-black/80"
          >
            <Printer size={15} /> Imprimir
          </button>
        </div>
      </div>
      {hint && <p className="text-right text-xs text-black/50">{hint}</p>}
    </div>
  );
}
