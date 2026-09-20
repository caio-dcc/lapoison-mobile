export type ProductCategory = 'comida' | 'bebida' | 'extra';

export interface OptionValue {
  id: string;
  name: string;
  price_delta: number;
  meat_delta: number;
}

export interface OptionGroup {
  id: string;
  name: string;
  required: boolean;
  values: OptionValue[];
}

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  price: number;
  active: boolean;
  meat_grams: number;
  bun_count: number;
  option_groups?: OptionGroup[];
}

export interface ChosenOption {
  group_name: string;
  value_name: string;
  price_delta: number;
  meat_delta: number;
}

export interface SaleItem {
  product_id: string;
  name: string;
  category: ProductCategory;
  unit_price: number;
  quantity: number;
  meat_grams: number;
  bun_count: number;
  options: ChosenOption[];
  /** Chave local única: produto + combinação de opções. */
  key: string;
}

export type PaymentMethod = 'dinheiro' | 'pix' | 'credito' | 'debito';

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Crédito',
  debito: 'Débito',
};

/** Linha pré-agregada do resumo diário. */
export interface DailySummary {
  sale_date: string;
  total: number;
  sales_count: number;
  meat_grams: number;
  bun_count: number;
  notes_count: number;
  photos_count: number;
}

export interface DashboardOverview {
  today_total: number;
  today_count: number;
  today_meat: number;
  today_buns: number;

  week_total: number;
  week_count: number;
  week_meat: number;
  week_buns: number;

  month_total: number;
  month_count: number;
  month_food: number;
  month_drink: number;
  month_extra: number;
  month_meat: number;
  month_buns: number;

  prev_month_total: number;
  avg_ticket_month: number;

  last_7_days: { sale_date: string; total: number; meat_grams: number }[];
  top_products: {
    name: string;
    category: ProductCategory;
    qty: number;
    total: number;
  }[];
  top_options: { group_name: string; value_name: string; qty: number }[];
}

export interface DayNote {
  id: string;
  body: string;
  created_at: string;
}

export interface DayPhoto {
  id: string;
  storage_path: string;
  caption: string | null;
  created_at: string;
}

export interface DaySaleItem {
  name: string;
  category: ProductCategory;
  quantity: number;
  unit_price: number;
  meat_grams: number;
  options: { group_name: string; value_name: string }[];
}

export interface DaySale {
  id: string;
  sold_at: string;
  customer_name: string | null;
  total: number;
  payment_method: PaymentMethod | null;
  items: DaySaleItem[];
}

/** Payload completo de um dia, devolvido em uma única chamada. */
export interface DayDetail {
  summary: DailySummary;
  sales: DaySale[];
  notes: DayNote[];
  photos: DayPhoto[];
}

/** Formata gramas como kg quando passa de 1000. */
export function formatMeat(grams: number): string {
  if (!grams) return '0 g';
  if (grams >= 1000) {
    return `${(grams / 1000).toFixed(grams % 1000 === 0 ? 0 : 1).replace('.', ',')} kg`;
  }
  return `${grams} g`;
}
