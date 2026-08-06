"use client";

import { Download } from "lucide-react";
import type { MovementWithRelations } from "@/lib/types";

function toCsvValue(value: unknown) {
  const str = String(value ?? "");
  return /[",\n;]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function ExportCsvButton({
  movements,
  filename,
}: {
  movements: MovementWithRelations[];
  filename: string;
}) {
  function handleExport() {
    const headers = [
      "Data",
      "Item",
      "SKU",
      "Tipo",
      "Subtipo",
      "Quantidade",
      "Valor unitário",
      "Valor total",
      "Forma de pagamento",
      "Parcelas",
      "Quem fez",
      "Canal",
    ];

    const rows = movements.map((m) => [
      m.created_at,
      m.items?.name ?? "",
      m.items?.sku ?? "",
      m.type,
      m.subtype ?? "",
      m.quantity,
      m.unit_value ?? "",
      m.total_value ?? "",
      m.payment_method ?? "",
      m.installments ?? "",
      m.employees?.full_name ?? "",
      m.source_channel,
    ]);

    const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button onClick={handleExport} className="btn-secondary">
      <Download size={16} />
      Exportar CSV
    </button>
  );
}
