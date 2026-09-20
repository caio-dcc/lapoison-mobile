import { supabase } from './supabase';
import type {
  ChosenOption,
  DailySummary,
  DashboardOverview,
  DayDetail,
  OptionGroup,
  PaymentMethod,
  Product,
  ProductCategory,
  SaleItem,
} from './types';

/**
 * Cache em memória com TTL. Evita refazer a mesma consulta ao
 * trocar de aba — a segunda visita abre instantânea.
 */
const cache = new Map<string, { at: number; data: unknown }>();
const TTL = 60_000;

function readCache<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL) {
    cache.delete(key);
    return null;
  }
  return hit.data as T;
}

function writeCache(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
}

/** Invalida tudo que depende de vendas (após registrar venda). */
export function invalidateSalesCache() {
  for (const key of cache.keys()) {
    if (key !== 'products') cache.delete(key);
  }
}

/** Invalida apenas o dia informado (após nota/foto). */
export function invalidateDay(date: string) {
  cache.delete(`day:${date}`);
  const month = `${date.slice(0, 7)}-01`;
  cache.delete(`month:${month}`);
}

export function todayISO(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Produtos + grupos de opção
// ---------------------------------------------------------------------
export async function fetchProducts(force = false): Promise<Product[]> {
  if (!force) {
    const cached = readCache<Product[]>('products');
    if (cached) return cached;
  }

  const [productsRes, linksRes, groupsRes, valuesRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, category, price, active, meat_grams, bun_count')
      .eq('active', true)
      .order('category')
      .order('sort_order'),
    supabase.from('product_option_groups').select('product_id, group_id'),
    supabase
      .from('option_groups')
      .select('id, name, required, sort_order')
      .order('sort_order'),
    supabase
      .from('option_values')
      .select('id, group_id, name, price_delta, meat_delta, active, sort_order')
      .eq('active', true)
      .order('sort_order'),
  ]);

  const err =
    productsRes.error || linksRes.error || groupsRes.error || valuesRes.error;
  if (err) throw err;

  // Monta os grupos com seus valores
  const valuesByGroup = new Map<string, any[]>();
  for (const v of valuesRes.data ?? []) {
    const list = valuesByGroup.get(v.group_id) ?? [];
    list.push({
      id: v.id,
      name: v.name,
      price_delta: Number(v.price_delta),
      meat_delta: Number(v.meat_delta ?? 0),
    });
    valuesByGroup.set(v.group_id, list);
  }

  const groupById = new Map<string, OptionGroup>();
  for (const g of groupsRes.data ?? []) {
    groupById.set(g.id, {
      id: g.id,
      name: g.name,
      required: g.required,
      values: valuesByGroup.get(g.id) ?? [],
    });
  }

  const groupsByProduct = new Map<string, OptionGroup[]>();
  for (const link of linksRes.data ?? []) {
    const group = groupById.get(link.group_id);
    if (!group || group.values.length === 0) continue;
    const list = groupsByProduct.get(link.product_id) ?? [];
    list.push(group);
    groupsByProduct.set(link.product_id, list);
  }

  const products: Product[] = (productsRes.data ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    price: Number(p.price),
    active: p.active,
    meat_grams: Number(p.meat_grams ?? 0),
    bun_count: Number(p.bun_count ?? 0),
    option_groups: groupsByProduct.get(p.id) ?? [],
  }));

  writeCache('products', products);
  return products;
}

export function groupByCategory(products: Product[]) {
  const groups: Record<ProductCategory, Product[]> = {
    comida: [],
    bebida: [],
    extra: [],
  };
  for (const p of products) groups[p.category]?.push(p);
  return groups;
}

// ---------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------
export async function fetchDashboard(force = false): Promise<DashboardOverview> {
  if (!force) {
    const cached = readCache<DashboardOverview>('dashboard');
    if (cached) return cached;
  }

  const { data, error } = await supabase.rpc('dashboard_overview');
  if (error) throw error;

  const overview = data as DashboardOverview;
  writeCache('dashboard', overview);
  return overview;
}

// ---------------------------------------------------------------------
// Calendário
// ---------------------------------------------------------------------
export async function fetchMonthCalendar(
  monthISO: string,
  force = false
): Promise<DailySummary[]> {
  const key = `month:${monthISO}`;
  if (!force) {
    const cached = readCache<DailySummary[]>(key);
    if (cached) return cached;
  }

  const { data, error } = await supabase.rpc('month_calendar', {
    target_month: monthISO,
  });
  if (error) throw error;

  const rows = (data ?? []) as DailySummary[];
  writeCache(key, rows);
  return rows;
}

/** Dia completo (resumo + vendas + notas + fotos) em 1 chamada. */
export async function fetchDayDetail(
  date: string,
  force = false
): Promise<DayDetail> {
  const key = `day:${date}`;
  if (!force) {
    const cached = readCache<DayDetail>(key);
    if (cached) return cached;
  }

  const { data, error } = await supabase.rpc('day_detail', {
    target_date: date,
  });
  if (error) throw error;

  const detail = data as DayDetail;
  writeCache(key, detail);
  return detail;
}

// ---------------------------------------------------------------------
// Registro de venda
// ---------------------------------------------------------------------
export interface NewSaleInput {
  customerName: string;
  items: SaleItem[];
  paymentMethod: PaymentMethod | null;
  note?: string;
}

/** Preço unitário final = base + acréscimos das opções. */
export function itemUnitPrice(item: {
  unit_price: number;
  options: ChosenOption[];
}): number {
  return (
    item.unit_price +
    item.options.reduce((sum, o) => sum + (o.price_delta ?? 0), 0)
  );
}

export function itemMeatGrams(item: {
  meat_grams: number;
  options: ChosenOption[];
}): number {
  return (
    item.meat_grams +
    item.options.reduce((sum, o) => sum + (o.meat_delta ?? 0), 0)
  );
}

export async function createSale(input: NewSaleInput): Promise<string> {
  const payload = input.items.map((i) => ({
    product_id: i.product_id,
    name: i.name,
    category: i.category,
    unit_price: i.unit_price,
    quantity: i.quantity,
    meat_grams: i.meat_grams,
    bun_count: i.bun_count,
    options: i.options.map((o) => ({
      group_name: o.group_name,
      value_name: o.value_name,
      price_delta: o.price_delta,
      meat_delta: o.meat_delta,
    })),
  }));

  const { data, error } = await supabase.rpc('create_sale', {
    p_customer_name: input.customerName,
    p_items: payload,
    p_payment_method: input.paymentMethod,
    p_note: input.note ?? null,
    p_sale_date: null,
  });

  if (error) throw error;

  invalidateSalesCache();
  return data as string;
}

export async function deleteSale(id: string, date: string): Promise<void> {
  const { error } = await supabase.from('sales').delete().eq('id', id);
  if (error) throw error;
  invalidateSalesCache();
  cache.delete(`day:${date}`);
}

// ---------------------------------------------------------------------
// Diário do dia — notas e fotos
// ---------------------------------------------------------------------
export async function addDayNote(day: string, body: string): Promise<void> {
  const { error } = await supabase.from('day_notes').insert({ day, body });
  if (error) throw error;
  invalidateDay(day);
}

export async function deleteDayNote(id: string, day: string): Promise<void> {
  const { error } = await supabase.from('day_notes').delete().eq('id', id);
  if (error) throw error;
  invalidateDay(day);
}

export const PHOTO_BUCKET = 'day-photos';

/** Envia a foto ao Storage e registra a linha no banco. */
export async function addDayPhoto(
  day: string,
  fileUri: string,
  caption?: string
): Promise<void> {
  const ext = (fileUri.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase();
  const path = `${day}/${Date.now()}.${ext}`;

  // React Native: converte o arquivo local em ArrayBuffer.
  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, arrayBuffer, {
      contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      upsert: false,
    });
  if (upErr) throw upErr;

  const { error } = await supabase
    .from('day_photos')
    .insert({ day, storage_path: path, caption: caption ?? null });
  if (error) throw error;

  invalidateDay(day);
}

export async function deleteDayPhoto(
  id: string,
  day: string,
  storagePath: string
): Promise<void> {
  await supabase.storage.from(PHOTO_BUCKET).remove([storagePath]);
  const { error } = await supabase.from('day_photos').delete().eq('id', id);
  if (error) throw error;
  invalidateDay(day);
}

export function photoUrl(storagePath: string): string {
  const { data } = supabase.storage
    .from(PHOTO_BUCKET)
    .getPublicUrl(storagePath);
  return data.publicUrl;
}

// ---------------------------------------------------------------------
// Cadastro de produtos
// ---------------------------------------------------------------------
export interface ProductInput {
  name: string;
  category: ProductCategory;
  price: number;
  meat_grams: number;
  bun_count: number;
}

export async function upsertProduct(
  input: ProductInput & { id?: string }
): Promise<void> {
  const payload = {
    name: input.name,
    category: input.category,
    price: input.price,
    meat_grams: input.meat_grams,
    bun_count: input.bun_count,
  };

  const { error } = input.id
    ? await supabase.from('products').update(payload).eq('id', input.id)
    : await supabase.from('products').insert(payload);

  if (error) throw error;
  cache.delete('products');
}

export async function deactivateProduct(id: string): Promise<void> {
  const { error } = await supabase
    .from('products')
    .update({ active: false })
    .eq('id', id);
  if (error) throw error;
  cache.delete('products');
}
