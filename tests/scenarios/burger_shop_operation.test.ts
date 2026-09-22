import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMeat, brl } from '../../src/lib/metrics';

/**
 * Cenário Completo de Operação Real:
 * Turno Noturno de Sexta-feira em Hamburgueria de Pequeno Porte (La Viela)
 */
describe('Cenário Operacional Real - Turno Completo de Hamburgueria', () => {
  interface Order {
    orderNumber: number;
    customer: string;
    items: {
      product: string;
      category: 'comida' | 'bebida' | 'extra';
      unitPrice: number;
      qty: number;
      meatGrams: number;
      buns: number;
      cheese?: 'Cheddar' | 'Mussarela' | 'Sem queijo';
      version?: 'Normal' | 'Zero';
    }[];
    payment: 'pix' | 'dinheiro' | 'credito' | 'debito';
  }

  // 20 pedidos representativos de uma noite movimentada
  const shiftOrders: Order[] = [
    {
      orderNumber: 1,
      customer: 'Carlos',
      payment: 'pix',
      items: [
        { product: 'A La Smash', category: 'comida', unitPrice: 18, qty: 2, meatGrams: 70, buns: 1, cheese: 'Mussarela' },
        { product: 'Refrigerante Lata 350ml', category: 'bebida', unitPrice: 7, qty: 2, meatGrams: 0, buns: 0, version: 'Zero' },
      ],
    },
    {
      orderNumber: 2,
      customer: 'Mariana',
      payment: 'credito',
      items: [
        { product: 'A La Cheese', category: 'comida', unitPrice: 22, qty: 1, meatGrams: 100, buns: 1, cheese: 'Cheddar' },
        { product: 'Batata Frita Média', category: 'comida', unitPrice: 27, qty: 1, meatGrams: 0, buns: 0 },
        { product: 'Coca-Cola 1,5L', category: 'bebida', unitPrice: 15, qty: 1, meatGrams: 0, buns: 0, version: 'Normal' },
      ],
    },
    {
      orderNumber: 3,
      customer: 'Lucas & Família',
      payment: 'pix',
      items: [
        { product: 'A La Cheese Duplo', category: 'comida', unitPrice: 30, qty: 2, meatGrams: 200, buns: 1, cheese: 'Cheddar' },
        { product: 'A La Smash', category: 'comida', unitPrice: 18, qty: 2, meatGrams: 70, buns: 1, cheese: 'Mussarela' },
        { product: 'Batata Frita Suprema', category: 'comida', unitPrice: 40, qty: 1, meatGrams: 0, buns: 0 },
        { product: 'Coca-Cola 1,5L', category: 'bebida', unitPrice: 15, qty: 1, meatGrams: 0, buns: 0, version: 'Normal' },
      ],
    },
    {
      orderNumber: 4,
      customer: 'Bruno',
      payment: 'debito',
      items: [
        { product: 'A L\'Alho', category: 'comida', unitPrice: 27, qty: 1, meatGrams: 100, buns: 1, cheese: 'Mussarela' },
        { product: 'Heineken Latão 473ml', category: 'bebida', unitPrice: 10, qty: 2, meatGrams: 0, buns: 0 },
      ],
    },
    {
      orderNumber: 5,
      customer: 'Fernanda',
      payment: 'dinheiro',
      items: [
        { product: 'A La Rings', category: 'comida', unitPrice: 27, qty: 1, meatGrams: 100, buns: 1, cheese: 'Cheddar' },
        { product: 'Bacon', category: 'extra', unitPrice: 5, qty: 1, meatGrams: 0, buns: 0 },
        { product: 'Refrigerante Lata 350ml', category: 'bebida', unitPrice: 7, qty: 1, meatGrams: 0, buns: 0, version: 'Zero' },
      ],
    },
    {
      orderNumber: 6,
      customer: 'Gabriel',
      payment: 'pix',
      items: [
        { product: 'A La Cheese Duplo', category: 'comida', unitPrice: 30, qty: 1, meatGrams: 200, buns: 1, cheese: 'Cheddar' },
        { product: 'Blend 100g', category: 'extra', unitPrice: 10, qty: 1, meatGrams: 100, buns: 0 }, // Adicional de carne!
        { product: 'Brahma Latão 473ml', category: 'bebida', unitPrice: 8, qty: 2, meatGrams: 0, buns: 0 },
      ],
    },
    {
      orderNumber: 7,
      customer: 'Juliana',
      payment: 'credito',
      items: [
        { product: 'A La Piña', category: 'comida', unitPrice: 35, qty: 1, meatGrams: 100, buns: 1, cheese: 'Mussarela' },
        { product: 'Água Com Gás 500ml', category: 'bebida', unitPrice: 4, qty: 1, meatGrams: 0, buns: 0 },
      ],
    },
    {
      orderNumber: 8,
      customer: 'Roberto',
      payment: 'pix',
      items: [
        { product: 'A La Pancho', category: 'comida', unitPrice: 22, qty: 2, meatGrams: 0, buns: 1 }, // 2 pães, 0g blend
        { product: 'Guaravita', category: 'bebida', unitPrice: 3, qty: 2, meatGrams: 0, buns: 0 },
      ],
    },
    {
      orderNumber: 9,
      customer: 'Patricia',
      payment: 'credito',
      items: [
        { product: 'A La Crostini', category: 'comida', unitPrice: 16, qty: 1, meatGrams: 0, buns: 1 },
        { product: 'Anéis de Cebola Empanados', category: 'comida', unitPrice: 25, qty: 1, meatGrams: 0, buns: 0 },
        { product: 'Refrigerante Lata 350ml', category: 'bebida', unitPrice: 7, qty: 1, meatGrams: 0, buns: 0, version: 'Normal' },
      ],
    },
    {
      orderNumber: 10,
      customer: 'Mesa Balcão 1',
      payment: 'dinheiro',
      items: [
        { product: 'Linguiça Mista Acebolada', category: 'comida', unitPrice: 25, qty: 1, meatGrams: 0, buns: 0 },
        { product: 'Heineken Latão 473ml', category: 'bebida', unitPrice: 10, qty: 4, meatGrams: 0, buns: 0 },
      ],
    },
  ];

  it('calcula faturamento total e divisão por forma de pagamento perfeitamente', () => {
    let totalTurno = 0;
    const pagamentos: Record<string, number> = { pix: 0, dinheiro: 0, credito: 0, debito: 0 };

    for (const order of shiftOrders) {
      const orderTotal = order.items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0);
      totalTurno += orderTotal;
      pagamentos[order.payment] += orderTotal;
    }

    // Pedido 1: (18*2) + (7*2) = 36 + 14 = 50 (pix)
    // Pedido 2: 22 + 27 + 15 = 64 (credito)
    // Pedido 3: (30*2) + (18*2) + 40 + 15 = 60 + 36 + 40 + 15 = 151 (pix)
    // Pedido 4: 27 + (10*2) = 47 (debito)
    // Pedido 5: 27 + 5 + 7 = 39 (dinheiro)
    // Pedido 6: 30 + 10 + (8*2) = 56 (pix)
    // Pedido 7: 35 + 4 = 39 (credito)
    // Pedido 8: (22*2) + (3*2) = 44 + 6 = 50 (pix)
    // Pedido 9: 16 + 25 + 7 = 48 (credito)
    // Pedido 10: 25 + (10*4) = 65 (dinheiro)
    // Total Geral = 50 + 64 + 151 + 47 + 39 + 56 + 39 + 50 + 48 + 65 = 609.00

    assert.equal(totalTurno, 609.0);
    assert.equal(pagamentos.pix, 307.0);      // 50 + 151 + 56 + 50 = 307
    assert.equal(pagamentos.credito, 151.0);  // 64 + 39 + 48 = 151
    assert.equal(pagamentos.dinheiro, 104.0); // 39 + 65 = 104
    assert.equal(pagamentos.debito, 47.0);    // 47

    const somaPagamentos = pagamentos.pix + pagamentos.credito + pagamentos.dinheiro + pagamentos.debito;
    assert.equal(somaPagamentos, totalTurno);
  });

  it('calcula o consumo total de insumos (Gramas de Carne Blend e Pães) para a Mise en Place', () => {
    let totalMeatGrams = 0;
    let totalBuns = 0;

    for (const order of shiftOrders) {
      for (const item of order.items) {
        totalMeatGrams += item.meatGrams * item.qty;
        totalBuns += item.buns * item.qty;
      }
    }

    // Carne:
    // P1: (70*2) = 140g
    // P2: (100*1) = 100g
    // P3: (200*2) + (70*2) = 400 + 140 = 540g
    // P4: (100*1) = 100g
    // P5: (100*1) = 100g
    // P6: (200*1) + (100*1 blend extra) = 300g
    // P7: (100*1) = 100g
    // P8: 0g
    // P9: 0g
    // P10: 0g
    // Total Carne = 140 + 100 + 540 + 100 + 100 + 300 + 100 = 1380g
    assert.equal(totalMeatGrams, 1380);
    assert.equal(formatMeat(totalMeatGrams), '1,4 kg'); // 1380g formatado como 1,4 kg

    // Pães:
    // P1: 2
    // P2: 1
    // P3: 2 + 2 = 4
    // P4: 1
    // P5: 1
    // P6: 1
    // P7: 1
    // P8: 2
    // P9: 1
    // P10: 0
    // Total Pães = 2 + 1 + 4 + 1 + 1 + 1 + 1 + 2 + 1 = 14 pães
    assert.equal(totalBuns, 14);
  });

  it('avalia o ticket médio do turno', () => {
    const totalTurno = 609.0;
    const qtdPedidos = shiftOrders.length;
    const ticketMedio = Math.round((totalTurno / qtdPedidos) * 100) / 100;

    // 609 / 10 = R$ 60,90
    assert.equal(ticketMedio, 60.9);
  });

  it('extrai preferências de queijo e refrigerante para auxílio na gestão de compras', () => {
    let countCheddar = 0;
    let countMussarela = 0;
    let countRefriZero = 0;
    let countRefriNormal = 0;

    for (const order of shiftOrders) {
      for (const item of order.items) {
        if (item.cheese === 'Cheddar') countCheddar += item.qty;
        if (item.cheese === 'Mussarela') countMussarela += item.qty;
        if (item.version === 'Zero') countRefriZero += item.qty;
        if (item.version === 'Normal') countRefriNormal += item.qty;
      }
    }

    // Queijo:
    // Cheddar: P2(1) + P3(2) + P5(1) + P6(1) = 5
    // Mussarela: P1(2) + P3(2) + P4(1) + P7(1) = 6
    assert.equal(countCheddar, 5);
    assert.equal(countMussarela, 6);

    // Refri:
    // Zero: P1(2) + P5(1) = 3
    // Normal: P2(1) + P3(1) + P9(1) = 3
    assert.equal(countRefriZero, 3);
    assert.equal(countRefriNormal, 3);
  });
});
