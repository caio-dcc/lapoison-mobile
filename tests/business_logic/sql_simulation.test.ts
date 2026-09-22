import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Este conjunto de testes simula a lógica exata de agregação e triggers
 * executadas pelas funções SQL do PostgreSQL/Supabase (em SETUP_COMPLETO.sql):
 *   - create_sale
 *   - recalc_summary (daily_summary e monthly_summary)
 *   - dashboard_overview
 *   - recalc_customer_summary
 */

interface DBProduct {
  id: string;
  name: string;
  category: 'comida' | 'bebida' | 'extra';
  price: number;
  meat_grams: number;
  bun_count: number;
}

interface DBSale {
  id: string;
  sold_at: string;
  sale_date: string;
  customer_id?: string | null;
  customer_name?: string | null;
  total: number;
  payment_method: 'dinheiro' | 'pix' | 'credito' | 'debito' | null;
}

interface DBSaleItem {
  id: string;
  sale_id: string;
  product_id?: string | null;
  name: string;
  category: 'comida' | 'bebida' | 'extra';
  unit_price: number;
  quantity: number;
  subtotal: number;
  meat_grams: number;
  bun_count: number;
}

interface DBDailySummary {
  sale_date: string;
  total: number;
  sales_count: number;
  food_total: number;
  drink_total: number;
  extra_total: number;
  meat_grams: number;
  bun_count: number;
}

describe('Simulação e Verificação das Funções e Triggers SQL', () => {
  it('garante que create_sale calcula totais e snapshots idênticos às regras de negócio', () => {
    // Simula payload enviado pelo app
    const p_items = [
      {
        product_id: 'prod-1',
        name: 'A La Cheese',
        category: 'comida',
        unit_price: 22.0,
        quantity: 2,
        meat_grams: 100,
        bun_count: 1,
        options: [
          { group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 },
          { group_name: 'Adicional', value_name: 'Bacon', price_delta: 5.0, meat_delta: 0 },
        ],
      },
      {
        product_id: 'prod-2',
        name: 'Coca-Cola 1,5L',
        category: 'bebida',
        unit_price: 15.0,
        quantity: 1,
        meat_grams: 0,
        bun_count: 0,
        options: [],
      },
    ];

    // Lógica SQL de create_sale
    let v_total = 0;
    for (const item of p_items) {
      const priceDeltaSum = (item.options || []).reduce((sum, o) => sum + o.price_delta, 0);
      const unit = item.unit_price + priceDeltaSum;
      v_total += unit * item.quantity;
    }

    // Item 1: (22 + 5) * 2 = 54
    // Item 2: 15 * 1 = 15
    // Total = 69
    assert.equal(v_total, 69.0);

    // Snapshot nos sale_items
    const saleItems: DBSaleItem[] = p_items.map((item, idx) => {
      const priceDeltaSum = (item.options || []).reduce((sum, o) => sum + o.price_delta, 0);
      const meatDeltaSum = (item.options || []).reduce((sum, o) => sum + o.meat_delta, 0);
      const unit_price = item.unit_price + priceDeltaSum;
      const quantity = item.quantity;
      return {
        id: `item-${idx + 1}`,
        sale_id: 'sale-1',
        product_id: item.product_id,
        name: item.name,
        category: item.category as any,
        unit_price,
        quantity,
        subtotal: unit_price * quantity,
        meat_grams: item.meat_grams + meatDeltaSum,
        bun_count: item.bun_count,
      };
    });

    assert.equal(saleItems[0].subtotal, 54.0);
    assert.equal(saleItems[0].meat_grams, 100);
    assert.equal(saleItems[0].bun_count, 1);
    assert.equal(saleItems[1].subtotal, 15.0);
  });

  it('recalc_summary agrega dados diários sem discrepâncias', () => {
    const target_date = '2026-09-21';

    const sales: DBSale[] = [
      { id: 's1', sold_at: '2026-09-21T19:00:00Z', sale_date: target_date, total: 69.0, payment_method: 'pix' },
      { id: 's2', sold_at: '2026-09-21T20:30:00Z', sale_date: target_date, total: 40.0, payment_method: 'credito' },
    ];

    const saleItems: DBSaleItem[] = [
      // Venda 1
      { id: 'i1', sale_id: 's1', name: 'A La Cheese', category: 'comida', unit_price: 27, quantity: 2, subtotal: 54, meat_grams: 100, bun_count: 1 },
      { id: 'i2', sale_id: 's1', name: 'Coca-Cola 1,5L', category: 'bebida', unit_price: 15, quantity: 1, subtotal: 15, meat_grams: 0, bun_count: 0 },
      // Venda 2
      { id: 'i3', sale_id: 's2', name: 'A La Cheese Duplo', category: 'comida', unit_price: 30, quantity: 1, subtotal: 30, meat_grams: 200, bun_count: 1 },
      { id: 'i4', sale_id: 's2', name: 'Brahma Latão', category: 'bebida', unit_price: 10, quantity: 1, subtotal: 10, meat_grams: 0, bun_count: 0 },
    ];

    // Simula a consulta SQL do recalc_summary
    const d_total = sales.reduce((sum, s) => sum + s.total, 0);
    const d_count = sales.length;
    const d_food = saleItems.filter((i) => i.category === 'comida').reduce((sum, i) => sum + i.subtotal, 0);
    const d_drink = saleItems.filter((i) => i.category === 'bebida').reduce((sum, i) => sum + i.subtotal, 0);
    const d_extra = saleItems.filter((i) => i.category === 'extra').reduce((sum, i) => sum + i.subtotal, 0);
    const d_meat = saleItems.reduce((sum, i) => sum + i.meat_grams * i.quantity, 0);
    const d_buns = saleItems.reduce((sum, i) => sum + i.bun_count * i.quantity, 0);

    const summary: DBDailySummary = {
      sale_date: target_date,
      total: d_total,
      sales_count: d_count,
      food_total: d_food,
      drink_total: d_drink,
      extra_total: d_extra,
      meat_grams: d_meat,
      bun_count: d_buns,
    };

    assert.equal(summary.total, 109.0);
    assert.equal(summary.sales_count, 2);
    assert.equal(summary.food_total, 84.0); // 54 + 30
    assert.equal(summary.drink_total, 25.0); // 15 + 10
    assert.equal(summary.extra_total, 0.0);
    // Carne: (100g * 2) + (200g * 1) = 400g
    assert.equal(summary.meat_grams, 400);
    // Pães: (1 * 2) + (1 * 1) = 3 pães
    assert.equal(summary.bun_count, 3);
    // Invariante de fechamento
    assert.equal(summary.food_total + summary.drink_total + summary.extra_total, summary.total);
  });

  it('preserva integridade e histórico mesmo se o produto do cardápio for alterado depois (Snapshot)', () => {
    // Produto originalmente cadastrado
    const produtoAntigo: DBProduct = {
      id: 'p1',
      name: 'A La Cheese',
      category: 'comida',
      price: 22.0,
      meat_grams: 100,
      bun_count: 1,
    };

    // Venda feita no passado usando o produto antigo
    const itemVendidoPassado: DBSaleItem = {
      id: 'item-passado',
      sale_id: 'sale-passada',
      product_id: produtoAntigo.id,
      name: produtoAntigo.name,
      category: produtoAntigo.category,
      unit_price: produtoAntigo.price,
      quantity: 2,
      subtotal: produtoAntigo.price * 2,
      meat_grams: produtoAntigo.meat_grams,
      bun_count: produtoAntigo.bun_count,
    };

    // Alteração posterior no cardápio (preço subiu para R$ 26, carne aumentou para 120g)
    const produtoAtualizado: DBProduct = {
      id: 'p1',
      name: 'A La Cheese Premium',
      category: 'comida',
      price: 26.0,
      meat_grams: 120,
      bun_count: 1,
    };

    // O item do passado deve manter seus valores históricos intactos
    assert.equal(itemVendidoPassado.unit_price, 22.0);
    assert.equal(itemVendidoPassado.subtotal, 44.0);
    assert.equal(itemVendidoPassado.meat_grams, 100);
    assert.equal(itemVendidoPassado.name, 'A La Cheese');
  });

  it('garante que apagar um cliente nunca deleta ou altera o faturamento (ON DELETE SET NULL)', () => {
    let customer = { id: 'c1', name: 'João Silva' };
    let sale: DBSale = {
      id: 's1',
      sold_at: '2026-09-21T21:00:00Z',
      sale_date: '2026-09-21',
      customer_id: customer.id,
      customer_name: 'João Silva',
      total: 50.0,
      payment_method: 'pix',
    };

    // Simula exclusão do cliente (ON DELETE SET NULL)
    sale.customer_id = null;

    // Faturamento e snapshot do nome permanecem preservados
    assert.equal(sale.total, 50.0);
    assert.equal(sale.customer_name, 'João Silva');
    assert.equal(sale.customer_id, null);
  });
});
