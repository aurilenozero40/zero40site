import type { Role } from "./roles";
import type { PaymentMethod as SalePaymentMethod } from "./sales/pricing";

export type EmployeeRole = Role;

export type Employee = {
  id: string;
  full_name: string;
  role: EmployeeRole;
  telegram_chat_id: string | null;
  active: boolean;
  created_at: string;
};

export type Item = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  subcategory: string | null;
  manufacturer: string | null;
  description: string | null;
  unit: string;
  cost_price: number | null;
  sale_price: number | null;
  quantity: number;
  min_stock: number;
  reorder_point: number | null;
  max_stock: number | null;
  abc_class: "A" | "B" | "C" | null;
  location: string | null;
  supplier_id: string | null;
  track_serial: boolean;
  condition: "novo" | "seminovo";
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ItemSerialStatus = "estoque" | "vendido" | "baixado";

export type ItemSerial = {
  id: string;
  item_id: string;
  serial: string;
  status: ItemSerialStatus;
  sale_item_id: string | null;
  movement_in_id: string | null;
  movement_out_id: string | null;
  created_by: string | null;
  created_at: string;
  sold_at: string | null;
  removed_at: string | null;
};

export type Supplier = {
  id: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
};

export type Customer = {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type MovementType = "entrada" | "saida" | "ajuste";

export type MovementSubtype =
  | "compra"
  | "devolucao"
  | "transferencia"
  | "cancelamento"
  | "troca"
  | "uso"
  | "perda"
  | "venda"
  | "emprestimo"
  | "outros";

/** Forma de pagamento LEGADA das movimentações antigas (vendas novas usam sale_payments). */
export type PaymentMethod = "a_vista" | "pix" | "cartao";

export type Movement = {
  id: string;
  item_id: string;
  type: MovementType;
  subtype: MovementSubtype | null;
  quantity: number;
  unit_value: number | null;
  total_value: number | null;
  payment_method: PaymentMethod | null;
  installments: number | null;
  card_brand: string | null;
  discount_value: number | null;
  fee_percent: number | null;
  fee_value: number;
  net_value: number | null;
  adjustment_increases_stock: boolean | null;
  reason: string | null;
  source_channel: "web" | "telegram";
  sale_id: string | null;
  created_by: string;
  created_at: string;
};

export type MovementWithRelations = Movement & {
  items: Pick<Item, "id" | "name" | "sku" | "unit"> | null;
  employees: Pick<Employee, "id" | "full_name"> | null;
};

// ---- Vendas ---------------------------------------------------------------------------

export type SaleStatus = "pendente" | "concluida" | "cancelada" | "devolvida" | "parcialmente_devolvida";

export type Sale = {
  id: string;
  number: number;
  idempotency_key: string;
  status: SaleStatus;
  seller_id: string;
  customer_id: string | null;
  subtotal: number;
  discount_amount: number;
  interest_amount: number;
  total: number;
  refunded_amount: number;
  trade_in_amount: number;
  trade_in_item_id: string | null;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  item_id: string;
  item_name: string;
  item_sku: string | null;
  item_barcode: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number | null;
  line_total: number;
  returned_quantity: number;
};

export type SalePayment = {
  id: string;
  sale_id: string;
  method: SalePaymentMethod;
  amount: number;
  installments: number;
  installment_value: number | null;
  interest_percent: number;
  card_brand: string | null;
  fee_percent: number | null;
  fee_amount: number | null;
  net_amount: number | null;
};

export type AuditLog = {
  id: number;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  changes: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
};

export type CardFeeRates = Record<string, Record<number, number>>;

export type SaleDashboard = {
  revenue: number;
  sales_count: number;
  ticket_avg: number;
  interest: number;
  discounts: number;
  units_sold: number;
  by_payment: { method: SalePaymentMethod; amount: number; sales: number }[];
  by_seller: { seller: string; revenue: number; sales: number }[];
  daily: { day: string; revenue: number; sales: number }[];
};

export type StockAlerts = {
  low: { id: string; name: string; sku: string | null; quantity: number; min_stock: number; unit: string }[];
  out: { id: string; name: string; sku: string | null; unit: string }[];
};
