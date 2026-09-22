import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cartKey, groupByCategory } from '../../src/lib/metrics';
import type { ChosenOption, OptionGroup, Product, SaleItem } from '../../src/lib/types';

describe('Lógica de Carrinho e Pedidos (Hamburgueria)', () => {
  describe('cartKey() e Diferenciação de Variantes', () => {
    it('gera chave simples para produtos sem opções', () => {
      const key = cartKey('prod_123', []);
      assert.equal(key, 'prod_123');
    });

    it('gera chaves distintas para o mesmo hambúrguer com queijos diferentes', () => {
      const keyCheddar = cartKey('prod_cheese', [
        { group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 },
      ]);
      const keyMussarela = cartKey('prod_cheese', [
        { group_name: 'Queijo', value_name: 'Mussarela', price_delta: 0, meat_delta: 0 },
      ]);

      assert.notEqual(keyCheddar, keyMussarela);
      assert.equal(keyCheddar, 'prod_cheese::Queijo=Cheddar');
      assert.equal(keyMussarela, 'prod_cheese::Queijo=Mussarela');
    });

    it('mantém a mesma chave independente da ordem das opções selecionadas', () => {
      const optA: ChosenOption[] = [
        { group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 },
        { group_name: 'Versao', value_name: 'Ao Ponto', price_delta: 0, meat_delta: 0 },
      ];
      const optB: ChosenOption[] = [
        { group_name: 'Versao', value_name: 'Ao Ponto', price_delta: 0, meat_delta: 0 },
        { group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 },
      ];

      const keyA = cartKey('prod_burger', optA);
      const keyB = cartKey('prod_burger', optB);

      assert.equal(keyA, keyB);
    });
  });

  describe('Agrupamento e Remoção de Itens no Carrinho', () => {
    it('adiciona e incrementa quantidades mantendo variantes separadas', () => {
      let cart: SaleItem[] = [];

      function addToCart(product: Product, options: ChosenOption[]) {
        const key = cartKey(product.id, options);
        const idx = cart.findIndex((i) => i.key === key);
        if (idx >= 0) {
          cart[idx] = { ...cart[idx], quantity: cart[idx].quantity + 1 };
        } else {
          cart.push({
            key,
            product_id: product.id,
            name: product.name,
            category: product.category,
            unit_price: product.price,
            quantity: 1,
            meat_grams: product.meat_grams,
            bun_count: product.bun_count,
            options,
          });
        }
      }

      const cheeseProd: Product = {
        id: 'p_cheese',
        name: 'A La Cheese',
        category: 'comida',
        price: 22,
        active: true,
        meat_grams: 100,
        bun_count: 1,
      };

      // Adiciona 1 Cheese Cheddar
      addToCart(cheeseProd, [{ group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 }]);
      // Adiciona outro Cheese Cheddar (deve incrementar quantidade para 2)
      addToCart(cheeseProd, [{ group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 }]);
      // Adiciona 1 Cheese Mussarela (deve ser um item separado)
      addToCart(cheeseProd, [{ group_name: 'Queijo', value_name: 'Mussarela', price_delta: 0, meat_delta: 0 }]);

      assert.equal(cart.length, 2);
      assert.equal(cart[0].quantity, 2);
      assert.equal(cart[0].options[0].value_name, 'Cheddar');
      assert.equal(cart[1].quantity, 1);
      assert.equal(cart[1].options[0].value_name, 'Mussarela');
    });

    it('removeOne decrementa da última variante ou remove o item', () => {
      let cart: SaleItem[] = [
        {
          key: 'p_cheese::Queijo=Cheddar',
          product_id: 'p_cheese',
          name: 'A La Cheese',
          category: 'comida',
          unit_price: 22,
          quantity: 2,
          meat_grams: 100,
          bun_count: 1,
          options: [{ group_name: 'Queijo', value_name: 'Cheddar', price_delta: 0, meat_delta: 0 }],
        },
      ];

      function removeOne(productId: string) {
        const idx = [...cart].reverse().findIndex((i) => i.product_id === productId);
        if (idx < 0) return;
        const realIdx = cart.length - 1 - idx;
        if (cart[realIdx].quantity > 1) {
          cart[realIdx] = { ...cart[realIdx], quantity: cart[realIdx].quantity - 1 };
        } else {
          cart.splice(realIdx, 1);
        }
      }

      // Primeiro clique em menos: quantidade vai de 2 para 1
      removeOne('p_cheese');
      assert.equal(cart.length, 1);
      assert.equal(cart[0].quantity, 1);

      // Segundo clique em menos: item é removido do carrinho
      removeOne('p_cheese');
      assert.equal(cart.length, 0);
    });
  });

  describe('groupByCategory()', () => {
    it('separa produtos em comida, bebida e extra', () => {
      const produtos: Product[] = [
        { id: '1', name: 'A La Smash', category: 'comida', price: 18, active: true, meat_grams: 70, bun_count: 1 },
        { id: '2', name: 'Coca-Cola', category: 'bebida', price: 7, active: true, meat_grams: 0, bun_count: 0 },
        { id: '3', name: 'Bacon Extra', category: 'extra', price: 5, active: true, meat_grams: 0, bun_count: 0 },
      ];

      const agrupado = groupByCategory(produtos);
      assert.equal(agrupado.comida.length, 1);
      assert.equal(agrupado.comida[0].name, 'A La Smash');
      assert.equal(agrupado.bebida.length, 1);
      assert.equal(agrupado.bebida[0].name, 'Coca-Cola');
      assert.equal(agrupado.extra.length, 1);
      assert.equal(agrupado.extra[0].name, 'Bacon Extra');
    });
  });

  describe('Regras de Grupos de Opções (Obrigatório vs Opcional)', () => {
    const grupos: OptionGroup[] = [
      {
        id: 'g_queijo',
        name: 'Queijo',
        required: false, // Opcional
        values: [
          { id: 'v1', name: 'Mussarela', price_delta: 0, meat_delta: 0 },
          { id: 'v2', name: 'Cheddar', price_delta: 0, meat_delta: 0 },
          { id: 'v3', name: 'Sem queijo', price_delta: 0, meat_delta: 0 },
        ],
      },
      {
        id: 'g_versao',
        name: 'Versão',
        required: true, // Obrigatório (ex: refri Normal vs Zero)
        values: [
          { id: 'v4', name: 'Normal', price_delta: 0, meat_delta: 0 },
          { id: 'v5', name: 'Zero', price_delta: 0, meat_delta: 0 },
        ],
      },
    ];

    it('permite finalizar pedido se grupos obrigatórios estiverem preenchidos', () => {
      const chosen = {
        Versão: { id: 'v5', name: 'Zero', price_delta: 0, meat_delta: 0 },
      };

      const missing = grupos.filter((g) => g.required && !(chosen as any)[g.name]);
      assert.equal(missing.length, 0); // Válido
    });

    it('bloqueia confirmação se grupo obrigatório não estiver preenchido', () => {
      const chosen = {}; // Nenhum escolhido

      const missing = grupos.filter((g) => g.required && !(chosen as any)[g.name]);
      assert.equal(missing.length, 1);
      assert.equal(missing[0].name, 'Versão');
    });
  });
});
