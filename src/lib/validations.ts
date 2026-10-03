import { z } from "zod";
import { isValidDocument, onlyDigits } from "./documents";
import { MAX_INSTALLMENTS, PAYMENT_METHODS } from "./sales/pricing";

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

// ---- Produtos ----------------------------------------------------------------------------

export const itemSchema = z.object({
  name: z.string().trim().min(1, "Nome é obrigatório"),
  sku: optionalText,
  barcode: optionalText,
  category: optionalText,
  subcategory: optionalText,
  manufacturer: optionalText,
  description: optionalText,
  unit: z.string().trim().min(1).default("un"),
  cost_price: optionalNumber,
  sale_price: optionalNumber,
  min_stock: z.coerce.number().min(0, "Estoque mínimo não pode ser negativo"),
  reorder_point: optionalNumber,
  max_stock: optionalNumber,
  location: z.string().trim().min(1).default("principal"),
  supplier_id: optionalText,
  track_serial: z.boolean().default(false),
  condition: z.enum(["novo", "seminovo"]).default("novo"),
  warranty_months: optionalNumber.refine(
    (v) => v === null || v === undefined || (Number.isInteger(v) && v > 0),
    "Garantia deve ser um número inteiro de meses maior que zero"
  ),
});

export type ItemInput = z.input<typeof itemSchema>;

// ---- Movimentações manuais de estoque (venda NÃO é feita aqui: é no PDV) -----------------------

const serials = z.array(z.string().trim().min(1)).max(500).optional();

export const movementSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("entrada"),
    item_id: z.string().uuid(),
    subtype: z.enum(["compra", "devolucao", "transferencia", "outros"]),
    quantity: z.coerce.number().positive("Quantidade deve ser maior que zero"),
    unit_value: optionalNumber,
    reason: optionalText,
    serials,
    supplier_id: z.string().uuid().nullable().optional(),
  }),
  z.object({
    type: z.literal("saida"),
    item_id: z.string().uuid(),
    subtype: z.enum(["uso", "perda", "emprestimo", "outros"]),
    quantity: z.coerce.number().positive("Quantidade deve ser maior que zero"),
    unit_value: optionalNumber,
    reason: optionalText,
    serials,
  }),
  z.object({
    type: z.literal("ajuste"),
    item_id: z.string().uuid(),
    quantity: z.coerce.number().positive("Quantidade deve ser maior que zero"),
    adjustment_increases_stock: z.boolean(),
    reason: z.string().trim().min(1, "Motivo é obrigatório para ajuste"),
    serials,
  }),
]);

export type MovementInput = z.input<typeof movementSchema>;

// ---- Clientes ------------------------------------------------------------------------------------

const optionalDocument = z
  .string()
  .trim()
  .transform((v) => onlyDigits(v))
  .refine((v) => v === "" || isValidDocument(v), "CPF/CNPJ inválido")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

const optionalEmail = z
  .string()
  .trim()
  .refine((v) => v === "" || z.string().email().safeParse(v).success, "E-mail inválido")
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .nullable()
  .optional();

const optionalPhone = z
  .string()
  .trim()
  .transform((v) => onlyDigits(v))
  .refine((v) => v === "" || (v.length >= 10 && v.length <= 13), "Telefone inválido (com DDD)")
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do cliente"),
  document: optionalDocument,
  phone: optionalPhone,
  whatsapp: optionalPhone,
  email: optionalEmail,
  address: optionalText,
  notes: optionalText,
});

export type CustomerInput = z.input<typeof customerSchema>;

// ---- Vendas ----------------------------------------------------------------------------------------
// Validação de FORMATO na borda; as regras de verdade (estoque, preço, desconto, taxa) são do banco.

export const saleInputSchema = z.object({
  idempotencyKey: z.string().uuid("Chave da venda inválida"),
  customerId: z.string().uuid().nullable().optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().positive("Quantidade deve ser maior que zero").max(1_000_000),
        serials: z.array(z.string().trim().min(1)).max(1000).optional(),
      })
    )
    .min(1, "Adicione ao menos um produto")
    .max(100, "Máximo de 100 itens por venda"),
  discountAmount: z.number().min(0, "Desconto inválido").max(100_000_000).default(0),
  paymentMethod: z.enum(PAYMENT_METHODS),
  installments: z.number().int().min(1).max(MAX_INSTALLMENTS).default(1),
  interestPercent: z.number().min(0, "Juros inválido").max(100, "Juros inválido").default(0),
  cardBrand: z.string().trim().max(30).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  tradeIn: z
    .object({
      itemName: z.string().trim().min(1, "Informe o nome do produto recebido de entrada"),
      category: z.string().trim().max(60).nullable().optional(),
      value: z.number().positive("Informe o valor do produto recebido de entrada"),
    })
    .nullable()
    .optional(),
});

export type SaleInput = z.input<typeof saleInputSchema>;

export const cancelSaleSchema = z.object({
  saleId: z.string().uuid(),
  reason: z.string().trim().min(3, "Informe o motivo do cancelamento").max(300),
});

export const returnSaleSchema = z.object({
  saleId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  reason: z.string().trim().min(3, "Informe o motivo da devolução").max(300),
  items: z
    .array(
      z.object({
        saleItemId: z.string().uuid(),
        quantity: z.number().positive(),
        serials: z.array(z.string().trim().min(1)).max(1000).optional(),
      })
    )
    .min(1, "Selecione ao menos um item para devolver"),
});
