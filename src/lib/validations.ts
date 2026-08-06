import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalNumber = z
  .union([z.number(), z.nan(), z.literal("")])
  .transform((v) => (v === "" || (typeof v === "number" && Number.isNaN(v)) ? null : v))
  .nullable()
  .optional();

export const itemSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório"),
  sku: optionalText,
  barcode: optionalText,
  category: optionalText,
  subcategory: optionalText,
  manufacturer: optionalText,
  unit: z.string().trim().min(1).default("un"),
  cost_price: optionalNumber,
  sale_price: optionalNumber,
  min_stock: z.coerce.number().min(0, "Estoque mínimo não pode ser negativo"),
  reorder_point: optionalNumber,
  max_stock: optionalNumber,
  location: z.string().trim().min(1).default("principal"),
  supplier_id: optionalText,
});

export type ItemInput = z.input<typeof itemSchema>;

export const movementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("entrada"),
    item_id: z.string().uuid(),
    subtype: z.enum(["compra", "devolucao", "transferencia"]),
    quantity: z.coerce.number().positive("Quantidade deve ser maior que zero"),
    unit_value: optionalNumber,
    reason: optionalText,
  }),
  z.object({
    type: z.literal("saida"),
    item_id: z.string().uuid(),
    subtype: z.enum(["uso", "perda", "venda", "emprestimo"]),
    quantity: z.coerce.number().positive("Quantidade deve ser maior que zero"),
    unit_value: optionalNumber,
    payment_method: z.enum(["a_vista", "pix", "cartao"]).nullable().optional(),
    installments: z.coerce.number().int().min(1).nullable().optional(),
    reason: optionalText,
  }),
  z.object({
    type: z.literal("ajuste"),
    item_id: z.string().uuid(),
    quantity: z.coerce.number().positive("Quantidade deve ser maior que zero"),
    adjustment_increases_stock: z.boolean(),
    reason: z.string().trim().min(1, "Motivo é obrigatório para ajuste"),
  }),
]);

export type MovementInput = z.input<typeof movementSchema>;
