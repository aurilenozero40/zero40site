export type EmployeeRole = "admin" | "staff";

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
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Supplier = {
  id: string;
  name: string;
  cnpj: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
};

export type MovementType = "entrada" | "saida" | "ajuste";

export type MovementSubtype =
  | "compra"
  | "devolucao"
  | "transferencia"
  | "uso"
  | "perda"
  | "venda"
  | "emprestimo";

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
  created_by: string;
  created_at: string;
};

export type MovementWithRelations = Movement & {
  items: Pick<Item, "id" | "name" | "sku" | "unit"> | null;
  employees: Pick<Employee, "id" | "full_name"> | null;
};
