import type { ChosenOption, PaymentMethod, Product, ProductCategory, SaleItem } from './types';

// =====================================================================
// FORMATAÇÃO E MOEDA
// =====================================================================

/**
 * Formata valores monetários no padrão Real Brasileiro (R$ 0,00).
 */
export function brl(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value ?? 0);
}

/**
 * Formata valores compactados para exibição em gráficos ou badges (ex: R$ 1,5k).
 */
export function brlCompact(value: number): string {
  if (Math.abs(value ?? 0) >= 1000) {
    return `R$ ${((value ?? 0) / 1000).toFixed(1).replace('.', ',')}k`;
  }
  return brl(value ?? 0);
}

/**
 * Formata gramas como kg quando passa de 1000g (ex: 70g -> '70 g', 1500g -> '1,5 kg').
 */
export function formatMeat(grams: number): string {
  if (!grams || isNaN(grams) || grams <= 0) return '0 g';
  if (grams >= 1000) {
    const inKg = grams / 1000;
    return `${inKg.toFixed(grams % 1000 === 0 ? 0 : 1).replace('.', ',')} kg`;
  }
  return `${Math.round(grams)} g`;
}

// =====================================================================
// CÁLCULOS UNITÁRIOS E DE OPÇÕES
// =====================================================================

/**
 * Preço unitário final = preço base do produto + soma dos acréscimos das opções.
 */
export function itemUnitPrice(item: {
  unit_price: number;
  options: ChosenOption[];
}): number {
  const base = item.unit_price ?? 0;
  const deltas = (item.options ?? []).reduce((sum, o) => sum + (o.price_delta ?? 0), 0);
  return Math.round((base + deltas) * 100) / 100;
}

/**
 * Gramas de carne do item = carne base do produto + deltas de carne das opções.
 */
export function itemMeatGrams(item: {
  meat_grams: number;
  options: ChosenOption[];
}): number {
  const base = item.meat_grams ?? 0;
  const deltas = (item.options ?? []).reduce((sum, o) => sum + (o.meat_delta ?? 0), 0);
  return Math.max(0, base + deltas);
}

// =====================================================================
// CÁLCULOS DE CARRINHO / PEDIDO
// =====================================================================

/**
 * Chave local única para distinguir produtos iguais com opções diferentes no carrinho.
 */
export function cartKey(productId: string, options: ChosenOption[]): string {
  const sig = (options ?? [])
    .map((o) => `${o.group_name}=${o.value_name}`)
    .sort()
    .join('|');
  return sig ? `${productId}::${sig}` : productId;
}

/**
 * Calcula o valor total financeiro de um pedido ou carrinho.
 */
export function calculateOrderTotal(items: SaleItem[]): number {
  const total = (items ?? []).reduce(
    (sum, i) => sum + itemUnitPrice(i) * (i.quantity ?? 0),
    0
  );
  return Math.round(total * 100) / 100;
}

/**
 * Calcula a quantidade total de carne (em gramas) consumida em um pedido.
 */
export function calculateOrderMeatGrams(items: SaleItem[]): number {
  return (items ?? []).reduce(
    (sum, i) => sum + itemMeatGrams(i) * (i.quantity ?? 0),
    0
  );
}

/**
 * Calcula a contagem total de pães consumidos em um pedido.
 */
export function calculateOrderBuns(items: SaleItem[]): number {
  return (items ?? []).reduce(
    (sum, i) => sum + (i.bun_count ?? 0) * (i.quantity ?? 0),
    0
  );
}

/**
 * Decompõe o total financeiro nas categorias Comida, Bebida e Extra.
 */
export function calculateCategoryTotals(items: SaleItem[]): {
  foodTotal: number;
  drinkTotal: number;
  extraTotal: number;
  total: number;
} {
  let foodTotal = 0;
  let drinkTotal = 0;
  let extraTotal = 0;

  for (const item of items ?? []) {
    const subtotal = itemUnitPrice(item) * (item.quantity ?? 0);
    if (item.category === 'comida') foodTotal += subtotal;
    else if (item.category === 'bebida') drinkTotal += subtotal;
    else if (item.category === 'extra') extraTotal += subtotal;
  }

  foodTotal = Math.round(foodTotal * 100) / 100;
  drinkTotal = Math.round(drinkTotal * 100) / 100;
  extraTotal = Math.round(extraTotal * 100) / 100;
  const total = Math.round((foodTotal + drinkTotal + extraTotal) * 100) / 100;

  return { foodTotal, drinkTotal, extraTotal, total };
}

// =====================================================================
// MÉTRICAS GERENCIAIS DO DASHBOARD
// =====================================================================

/**
 * Calcula o Ticket Médio (Faturamento Total / Número de Vendas).
 */
export function calculateTicketMedio(totalSpent: number, salesCount: number): number {
  if (!salesCount || salesCount <= 0 || !totalSpent || totalSpent <= 0) return 0;
  return Math.round((totalSpent / salesCount) * 100) / 100;
}

/**
 * Calcula a variação percentual entre o mês atual e o mês anterior.
 * Retorna null se não houver histórico do mês anterior.
 */
export function calculateMonthDelta(
  currentMonthTotal: number,
  prevMonthTotal: number
): number | null {
  if (!prevMonthTotal || prevMonthTotal <= 0) return null;
  return Math.round(((currentMonthTotal - prevMonthTotal) / prevMonthTotal) * 1000) / 10;
}

/**
 * Agrupa lista de produtos pelas 3 categorias operacionais da hamburgueria.
 */
export function groupByCategory(products: Product[]): Record<ProductCategory, Product[]> {
  const groups: Record<ProductCategory, Product[]> = {
    comida: [],
    bebida: [],
    extra: [],
  };
  for (const p of products ?? []) {
    if (groups[p.category]) {
      groups[p.category].push(p);
    }
  }
  return groups;
}
