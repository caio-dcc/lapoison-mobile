import { supabase } from './supabase';
import { currentOperator } from './auth';
import type {
  ChosenOption,
  Customer,
  CustomerDetail,
  CustomerInput,
  CustomerRankings,
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

/**
 * Invalida tudo que depende de vendas (após registrar venda).
 * Só 'products' e a lista de clientes sobrevivem: catálogo e cadastro
 * não mudam ao vender. Os RANKINGS mudam, então caem aqui.
 */
export function invalidateSalesCache() {
  for (const key of cache.keys()) {
    if (key !== 'products' && key !== 'customers') cache.delete(key);
  }
}

/** Invalida o cadastro de clientes e os rankings derivados dele. */
export function invalidateCustomers() {
  cache.delete('customers');
  cache.delete('rankings');
  for (const key of cache.keys()) {
    if (key.startsWith('customer:')) cache.delete(key);
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
      .select('id, name, category, price, cost_price, active, meat_grams, bun_count')
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
    cost_price: Number(p.cost_price ?? 0),
    active: p.active,
    meat_grams: Number(p.meat_grams ?? 0),
    bun_count: Number(p.bun_count ?? 0),
    option_groups: groupsByProduct.get(p.id) ?? [],
  }));

  writeCache('products', products);
  return products;
}

export { groupByCategory } from './metrics';

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
export { itemMeatGrams, itemUnitPrice } from './metrics';

export interface NewSaleInput {
  customerName: string;
  /** Cliente cadastrado. Quando presente, o nome vem do cadastro. */
  customerId?: string | null;
  items: SaleItem[];
  paymentMethod: PaymentMethod | null;
  note?: string;
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

  const operator = await currentOperator();

  const { data, error } = await supabase.rpc('create_sale', {
    p_customer_name: input.customerName,
    p_items: payload,
    p_payment_method: input.paymentMethod,
    p_note: input.note ?? null,
    p_sale_date: null,
    p_customer_id: input.customerId ?? null,
    p_operator: operator,
  });

  if (error) throw error;

  invalidateSalesCache();
  return data as string;
}

// ---------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------
export interface AuditEntry {
  id: number;
  at: string;
  operator: string | null;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  row_id: string | null;
  summary: string | null;
}

export async function fetchAuditFeed(
  limit = 50,
  offset = 0
): Promise<AuditEntry[]> {
  const { data, error } = await supabase.rpc('audit_feed', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

export async function fetchAuditCount(): Promise<number> {
  const { data, error } = await supabase.rpc('audit_count');
  if (error) throw error;
  return (data as number) ?? 0;
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
  /** Custo de produção (insumos) — base do cálculo de lucro. */
  cost_price: number;
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
    cost_price: input.cost_price,
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

// ---------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------
export const CUSTOMER_BUCKET = 'customer-photos';

export async function fetchCustomers(force = false): Promise<Customer[]> {
  if (!force) {
    const cached = readCache<Customer[]>('customers');
    if (cached) return cached;
  }

  const { data, error } = await supabase
    .from('customers')
    .select('id, name, phone, notes, birth_date, photo_path, active, created_at')
    .eq('active', true)
    .order('name');

  if (error) throw error;

  const rows = (data ?? []) as Customer[];
  writeCache('customers', rows);
  return rows;
}

/** Rankings do dashboard: quem gastou mais + top por produto. */
export async function fetchCustomerRankings(
  force = false
): Promise<CustomerRankings> {
  if (!force) {
    const cached = readCache<CustomerRankings>('rankings');
    if (cached) return cached;
  }

  const { data, error } = await supabase.rpc('customer_rankings', {
    p_limit: 10,
  });
  if (error) throw error;

  const rankings = data as CustomerRankings;
  writeCache('rankings', rankings);
  return rankings;
}

/** Ficha do cliente: resumo + preferidos + últimas vendas, em 1 chamada. */
export async function fetchCustomerDetail(
  id: string,
  force = false
): Promise<CustomerDetail> {
  const key = `customer:${id}`;
  if (!force) {
    const cached = readCache<CustomerDetail>(key);
    if (cached) return cached;
  }

  const { data, error } = await supabase.rpc('customer_detail', {
    target_customer: id,
  });
  if (error) throw error;

  const detail = data as CustomerDetail;
  writeCache(key, detail);
  return detail;
}

export async function upsertCustomer(
  input: CustomerInput & { id?: string }
): Promise<string> {
  const payload = {
    name: input.name.trim(),
    phone: input.phone?.trim() || null,
    notes: input.notes?.trim() || null,
    birth_date: input.birth_date || null,
  };

  if (input.id) {
    const { error } = await supabase
      .from('customers')
      .update(payload)
      .eq('id', input.id);
    if (error) throw error;
    invalidateCustomers();
    return input.id;
  }

  const { data, error } = await supabase
    .from('customers')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw error;

  invalidateCustomers();
  return (data as { id: string }).id;
}

/** Desativa em vez de apagar: preserva o vínculo com as vendas. */
export async function deactivateCustomer(id: string): Promise<void> {
  const { error } = await supabase
    .from('customers')
    .update({ active: false })
    .eq('id', id);
  if (error) throw error;
  invalidateCustomers();
}

/** Normaliza o nome do cliente para um trecho seguro de caminho de arquivo. */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'cliente';
}

/**
 * Envia a foto do cliente ao Storage e grava o caminho.
 * Nome do arquivo identifica a origem (laviela) e o cliente, para ficar
 * claro ao navegar direto pelo bucket no painel do Supabase.
 */
export async function setCustomerPhoto(
  id: string,
  fileUri: string,
  customerName: string
): Promise<void> {
  const ext = (fileUri.split('.').pop() ?? 'jpg').split('?')[0].toLowerCase();
  const safeExt = ['jpg', 'jpeg', 'png'].includes(ext) ? ext : 'jpg';
  const path = `${id}/laviela-${slugify(customerName)}-${Date.now()}.${safeExt}`;

  const response = await fetch(fileUri);
  const arrayBuffer = await response.arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from(CUSTOMER_BUCKET)
    .upload(path, arrayBuffer, {
      contentType: safeExt === 'png' ? 'image/png' : 'image/jpeg',
      upsert: false,
    });
  if (upErr) throw upErr;

  const { error } = await supabase
    .from('customers')
    .update({ photo_path: path })
    .eq('id', id);
  if (error) throw error;

  invalidateCustomers();
}

export function customerPhotoUrl(storagePath: string | null): string | null {
  if (!storagePath) return null;
  const { data } = supabase.storage
    .from(CUSTOMER_BUCKET)
    .getPublicUrl(storagePath);
  return data.publicUrl;
}
