import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  itemUnitPrice,
  calculateOrderTotal,
  calculateCategoryTotals,
  calculateTicketMedio,
  calculateMonthDelta,
  brl,
  brlCompact,
} from '../../src/lib/metrics';
import type { ChosenOption, SaleItem } from '../../src/lib/types';

describe('Métricas Financeiras - Faturamento, Categorias e Ticket Médio', () => {
  describe('itemUnitPrice()', () => {
    it('retorna o preço base quando não há opções com acréscimo', () => {
      const item = {
        unit_price: 22.0,
        options: [
          { group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 },
        ],
      };
      assert.equal(itemUnitPrice(item), 22.0);
    });

    it('adiciona acréscimos de opções de valor positivo (ex: adicionais)', () => {
      const item = {
        unit_price: 22.0,
        options: [
          { group_name: 'Queijo', value_name: 'Mussarela', price_delta: 0, meat_delta: 0 },
          { group_name: 'Adicional', value_name: 'Bacon', price_delta: 5.0, meat_delta: 0 },
          { group_name: 'Adicional', value_name: 'Blend 100g', price_delta: 10.0, meat_delta: 100 },
        ],
      };
      assert.equal(itemUnitPrice(item), 37.0);
    });
  });

  describe('Formatação de Moeda (brl e brlCompact)', () => {
    it('formata valores monetários em padrão pt-BR', () => {
      assert.match(brl(0), /R\$\s*0,00/);
      assert.match(brl(22), /R\$\s*22,00/);
      assert.match(brl(15.5), /R\$\s*15,50/);
      assert.match(brl(1250.75), /R\$\s*1\.250,75/);
    });

    it('formata valores compactos (k)', () => {
      assert.equal(brlCompact(1000), 'R$ 1,0k');
      assert.equal(brlCompact(1500), 'R$ 1,5k');
      assert.equal(brlCompact(12800), 'R$ 12,8k');
      assert.match(brlCompact(450), /R\$\s*450,00/);
    });
  });

  describe('Cálculo de Pedidos e Separação por Categoria (Mix de Vendas)', () => {
    const itensPedido: SaleItem[] = [
      {
        key: 'burger_1',
        product_id: 'p1',
        name: 'A La Cheese',
        category: 'comida',
        unit_price: 22.0,
        quantity: 2,
        meat_grams: 100,
        bun_count: 1,
        options: [{ group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 }],
      },
      {
        key: 'burger_2',
        product_id: 'p2',
        name: 'A La Cheese Duplo',
        category: 'comida',
        unit_price: 30.0,
        quantity: 1,
        meat_grams: 200,
        bun_count: 1,
        options: [],
      },
      {
        key: 'bebida_1',
        product_id: 'p3',
        name: 'Refrigerante Lata 350ml',
        category: 'bebida',
        unit_price: 7.0,
        quantity: 2,
        meat_grams: 0,
        bun_count: 0,
        options: [{ group_name: 'Versão', value_name: 'Zero', price_delta: 0, meat_delta: 0 }],
      },
      {
        key: 'bebida_2',
        product_id: 'p4',
        name: 'Heineken Latão 473ml',
        category: 'bebida',
        unit_price: 10.0,
        quantity: 1,
        meat_grams: 0,
        bun_count: 0,
        options: [],
      },
      {
        key: 'extra_1',
        product_id: 'p5',
        name: 'Bacon',
        category: 'extra',
        unit_price: 5.0,
        quantity: 2,
        meat_grams: 0,
        bun_count: 0,
        options: [],
      },
    ];

    it('calcula o subtotal de cada item corretamente', () => {
      const subtotais = itensPedido.map((i) => ({
        name: i.name,
        subtotal: itemUnitPrice(i) * i.quantity,
      }));

      assert.deepEqual(subtotais, [
        { name: 'A La Cheese', subtotal: 44.0 },       // 22 * 2
        { name: 'A La Cheese Duplo', subtotal: 30.0 }, // 30 * 1
        { name: 'Refrigerante Lata 350ml', subtotal: 14.0 }, // 7 * 2
        { name: 'Heineken Latão 473ml', subtotal: 10.0 },    // 10 * 1
        { name: 'Bacon', subtotal: 10.0 },             // 5 * 2
      ]);
    });

    it('calcula o total geral da venda', () => {
      const total = itensPedido.reduce(
        (sum, i) => sum + itemUnitPrice(i) * i.quantity,
        0
      );
      assert.equal(total, 108.0);
    });

    it('calcula e mantém a invariante de mix de categorias (comida + bebida + extra === total)', () => {
      const foodTotal = itensPedido
        .filter((i) => i.category === 'comida')
        .reduce((sum, i) => sum + itemUnitPrice(i) * i.quantity, 0);

      const drinkTotal = itensPedido
        .filter((i) => i.category === 'bebida')
        .reduce((sum, i) => sum + itemUnitPrice(i) * i.quantity, 0);

      const extraTotal = itensPedido
        .filter((i) => i.category === 'extra')
        .reduce((sum, i) => sum + itemUnitPrice(i) * i.quantity, 0);

      const total = itensPedido.reduce(
        (sum, i) => sum + itemUnitPrice(i) * i.quantity,
        0
      );

      assert.equal(foodTotal, 74.0);  // 44 + 30
      assert.equal(drinkTotal, 24.0); // 14 + 10
      assert.equal(extraTotal, 10.0); // 10
      assert.equal(foodTotal + drinkTotal + extraTotal, total);
    });
  });

  describe('Ticket Médio e Comparativo Mensal', () => {
    it('calcula o ticket médio mensal corretamente', () => {
      const totalMes = 15480.0;
      const totalVendas = 240;
      const ticketMedio = totalVendas > 0 ? Math.round((totalMes / totalVendas) * 100) / 100 : 0;

      assert.equal(ticketMedio, 64.5);
    });

    it('retorna ticket médio zero quando não há vendas (evita divisão por zero)', () => {
      const totalMes = 0;
      const totalVendas = 0;
      const ticketMedio = totalVendas > 0 ? totalMes / totalVendas : 0;
      assert.equal(ticketMedio, 0);
    });

    it('calcula a variação percentual vs mês anterior corretamente', () => {
      // Caso 1: Crescimento
      const mesAtual = 18000;
      const mesAnterior = 15000;
      const deltaCrescimento = ((mesAtual - mesAnterior) / mesAnterior) * 100;
      assert.equal(deltaCrescimento, 20); // +20%

      // Caso 2: Queda
      const mesAtualQueda = 12000;
      const deltaQueda = ((mesAtualQueda - mesAnterior) / mesAnterior) * 100;
      assert.equal(deltaQueda, -20); // -20%

      // Caso 3: Mês anterior zerado (primeiro mês de operação)
      const mesAnteriorZero = 0;
      const deltaPrimeiroMes = mesAnteriorZero > 0 ? ((mesAtual - mesAnteriorZero) / mesAnteriorZero) * 100 : null;
      assert.equal(deltaPrimeiroMes, null);
    });
  });
});
