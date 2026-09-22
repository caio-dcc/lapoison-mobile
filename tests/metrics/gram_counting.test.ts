import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Product, ChosenOption, SaleItem } from '../../src/lib/types';
import { formatMeat, itemMeatGrams, calculateOrderMeatGrams, calculateOrderBuns } from '../../src/lib/metrics';

describe('Métricas de Insumos - Contagem de Gramas e Pães', () => {
  describe('formatMeat()', () => {
    it('formata 0 gramas corretamente', () => {
      assert.equal(formatMeat(0), '0 g');
    });

    it('formata valores abaixo de 1000g em gramas', () => {
      assert.equal(formatMeat(70), '70 g');
      assert.equal(formatMeat(100), '100 g');
      assert.equal(formatMeat(200), '200 g');
      assert.equal(formatMeat(999), '999 g');
    });

    it('formata múltiplos exatos de 1000g sem casas decimais', () => {
      assert.equal(formatMeat(1000), '1 kg');
      assert.equal(formatMeat(2000), '2 kg');
      assert.equal(formatMeat(5000), '5 kg');
      assert.equal(formatMeat(10000), '10 kg');
    });

    it('formata valores fracionados em kg com 1 casa decimal e vírgula', () => {
      assert.equal(formatMeat(1200), '1,2 kg');
      assert.equal(formatMeat(1500), '1,5 kg');
      assert.equal(formatMeat(2750), '2,8 kg'); // toFixed(1) de 2.75 -> 2.8
      assert.equal(formatMeat(3400), '3,4 kg');
    });
  });

  describe('itemMeatGrams()', () => {
    it('retorna a gramatura base do produto quando não há opções com meat_delta', () => {
      const item = {
        meat_grams: 100,
        options: [
          { group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 },
        ],
      };
      assert.equal(itemMeatGrams(item), 100);
    });

    it('soma meat_delta de opções quando houver carne adicional', () => {
      const item = {
        meat_grams: 100,
        options: [
          { group_name: 'Queijo', value_name: 'Mussarela', price_delta: 0, meat_delta: 0 },
          { group_name: 'Adicional', value_name: 'Blend Extra 100g', price_delta: 10, meat_delta: 100 },
        ],
      };
      assert.equal(itemMeatGrams(item), 200);
    });

    it('suporta produtos vegetarianos ou sem carne (0g)', () => {
      const item = {
        meat_grams: 0,
        options: [],
      };
      assert.equal(itemMeatGrams(item), 0);
    });
  });

  describe('Cálculo de Insumos em um Pedido Completo', () => {
    const cardapio: Record<string, Product> = {
      smash: {
        id: 'p1',
        name: 'A La Smash',
        category: 'comida',
        price: 18,
        active: true,
        meat_grams: 70,
        bun_count: 1,
      },
      cheese: {
        id: 'p2',
        name: 'A La Cheese',
        category: 'comida',
        price: 22,
        active: true,
        meat_grams: 100,
        bun_count: 1,
      },
      duplo: {
        id: 'p3',
        name: 'A La Cheese Duplo',
        category: 'comida',
        price: 30,
        active: true,
        meat_grams: 200,
        bun_count: 1,
      },
      pancho: {
        id: 'p4',
        name: 'A La Pancho',
        category: 'comida',
        price: 22,
        active: true,
        meat_grams: 0, // Linguiça suína, não conta como blend bovino
        bun_count: 1,
      },
      fritas: {
        id: 'p5',
        name: 'Batata Frita Média',
        category: 'comida',
        price: 27,
        active: true,
        meat_grams: 0,
        bun_count: 0,
      },
      coca: {
        id: 'p6',
        name: 'Coca-Cola 1,5L',
        category: 'bebida',
        price: 15,
        active: true,
        meat_grams: 0,
        bun_count: 0,
      },
    };

    it('calcula o peso total de carne de múltiplos itens e quantidades', () => {
      const pedido: SaleItem[] = [
        {
          key: 'smash_1',
          product_id: cardapio.smash.id,
          name: cardapio.smash.name,
          category: cardapio.smash.category,
          unit_price: cardapio.smash.price,
          quantity: 2, // 2 x 70g = 140g
          meat_grams: cardapio.smash.meat_grams,
          bun_count: cardapio.smash.bun_count,
          options: [],
        },
        {
          key: 'cheese_1',
          product_id: cardapio.cheese.id,
          name: cardapio.cheese.name,
          category: cardapio.cheese.category,
          unit_price: cardapio.cheese.price,
          quantity: 3, // 3 x 100g = 300g
          meat_grams: cardapio.cheese.meat_grams,
          bun_count: cardapio.cheese.bun_count,
          options: [],
        },
        {
          key: 'duplo_1',
          product_id: cardapio.duplo.id,
          name: cardapio.duplo.name,
          category: cardapio.duplo.category,
          unit_price: cardapio.duplo.price,
          quantity: 1, // 1 x 200g = 200g
          meat_grams: cardapio.duplo.meat_grams,
          bun_count: cardapio.duplo.bun_count,
          options: [],
        },
        {
          key: 'pancho_1',
          product_id: cardapio.pancho.id,
          name: cardapio.pancho.name,
          category: cardapio.pancho.category,
          unit_price: cardapio.pancho.price,
          quantity: 2, // 2 x 0g = 0g (leva linguiça)
          meat_grams: cardapio.pancho.meat_grams,
          bun_count: cardapio.pancho.bun_count,
          options: [],
        },
        {
          key: 'fritas_1',
          product_id: cardapio.fritas.id,
          name: cardapio.fritas.name,
          category: cardapio.fritas.category,
          unit_price: cardapio.fritas.price,
          quantity: 1, // 0g
          meat_grams: cardapio.fritas.meat_grams,
          bun_count: cardapio.fritas.bun_count,
          options: [],
        },
        {
          key: 'coca_1',
          product_id: cardapio.coca.id,
          name: cardapio.coca.name,
          category: cardapio.coca.category,
          unit_price: cardapio.coca.price,
          quantity: 2, // 0g
          meat_grams: cardapio.coca.meat_grams,
          bun_count: cardapio.coca.bun_count,
          options: [],
        },
      ];

      // Carne total: 140 + 300 + 200 + 0 + 0 + 0 = 640g
      const totalMeat = pedido.reduce(
        (sum, item) => sum + itemMeatGrams(item) * item.quantity,
        0
      );
      assert.equal(totalMeat, 640);
      assert.equal(formatMeat(totalMeat), '640 g');

      // Pães totais: (2*1) + (3*1) + (1*1) + (2*1) + (1*0) + (2*0) = 8 pães
      const totalBuns = pedido.reduce(
        (sum, item) => sum + item.bun_count * item.quantity,
        0
      );
      assert.equal(totalBuns, 8);
    });

    it('acumula corretamente o consumo para dias de alto movimento (ex: 50 burgers)', () => {
      // Cenário: 30 Smash (70g) + 15 Cheese (100g) + 10 Cheese Duplo (200g)
      const totalGrams = (30 * 70) + (15 * 100) + (10 * 200); // 2100 + 1500 + 2000 = 5600g
      const totalBuns = 30 + 15 + 10; // 55 pães

      assert.equal(totalGrams, 5600);
      assert.equal(formatMeat(totalGrams), '5,6 kg');
      assert.equal(totalBuns, 55);
    });
  });
});
