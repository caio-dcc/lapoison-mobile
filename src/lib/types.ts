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

// ---------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------
export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  birth_date: string | null;
  photo_path: string | null;
  active: boolean;
  created_at: string;
}

export interface CustomerInput {
  name: string;
  phone: string | null;
  notes: string | null;
  birth_date: string | null;
}

/** Cliente no ranking de quem mais gastou. */
export interface TopSpender {
  id: string;
  name: string;
  photo_path: string | null;
  total_spent: number;
  sales_count: number;
  meat_grams: number;
  last_sale: string | null;
  avg_ticket: number;
}

/** Para cada produto, o cliente que mais consumiu. */
export interface TopByProduct {
  product_name: string;
  category: ProductCategory;
  qty: number;
  total: number;
  customer_id: string;
  customer_name: string;
  photo_path: string | null;
}

export interface CustomerRankings {
  top_spenders: TopSpender[];
  top_by_product: TopByProduct[];
  customers_count: number;
  with_sales_count: number;
}

export interface CustomerDetail {
  summary: {
    total_spent: number;
    sales_count: number;
    meat_grams: number;
    first_sale: string | null;
    last_sale: string | null;
    avg_ticket: number;
  };
  favorites: {
    product_name: string;
    category: ProductCategory;
    qty: number;
    total: number;
  }[];
  recent_sales: {
    id: string;
    sold_at: string;
    sale_date: string;
    total: number;
    payment_method: PaymentMethod | null;
    items: { name: string; quantity: number }[];
  }[];
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
  customer_id?: string | null;
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

export { formatMeat } from './metrics';

/** dd/mm/aaaa para exibição; aceita null. */
export function formatBirth(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '—';
  return `${d}/${m}/${y}`;
}

/** Idade em anos a partir da data de nascimento. */
export function ageFrom(iso: string | null): number | null {
  if (!iso) return null;
  const birth = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const before =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (before) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/** Telefone brasileiro: (21) 99999-0000 */
export function formatPhone(raw: string | null): string {
  if (!raw) return '';
  const d = raw.replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw;
}
