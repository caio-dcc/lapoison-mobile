-- =====================================================================
-- La Viela — Cardápio real
-- Substitui o catálogo provisório (0002_seed_products.sql).
-- Ficha técnica: blend da casa 70g / 100g / 200g, 1 pão chapeado.
-- =====================================================================

-- Limpa o catálogo anterior. As vendas já registradas NÃO são afetadas:
-- sale_items guarda snapshot de nome/categoria/preço e o product_id vira null.
delete from product_option_groups;
delete from option_values;
delete from option_groups;
delete from products;

-- ---------------------------------------------------------------------
-- 🍔 Hambúrgueres
--   meat_grams = blend da casa · bun_count = pão chapeado
-- ---------------------------------------------------------------------
insert into products (name, category, price, meat_grams, bun_count, sort_order) values
  ('A La Smash',        'comida', 18.00,  70, 1, 1),
  ('A La Cheese',       'comida', 22.00, 100, 1, 2),
  ('A La Cheese Duplo', 'comida', 30.00, 200, 1, 3),
  ('A L''Alho',          'comida', 27.00, 100, 1, 4),
  ('A La Rings',        'comida', 27.00, 100, 1, 5),
  ('A La Piña',         'comida', 35.00, 100, 1, 6),
  -- Pancho leva linguiça suína no lugar do blend
  ('A La Pancho',       'comida', 22.00,   0, 1, 7),
  -- Crostini usa pão amanteigado, sem carne
  ('A La Crostini',     'comida', 16.00,   0, 1, 8);

-- ---------------------------------------------------------------------
-- 🍟 Acompanhamentos
-- ---------------------------------------------------------------------
insert into products (name, category, price, meat_grams, bun_count, sort_order) values
  ('Batata Frita Pequena',        'comida', 12.00, 0, 0, 20),
  ('Batata Frita Média',          'comida', 27.00, 0, 0, 21),
  ('Batata Frita Suprema',        'comida', 40.00, 0, 0, 22),
  ('Anéis de Cebola Empanados',   'comida', 25.00, 0, 0, 23),
  ('Linguiça Mista Acebolada',    'comida', 25.00, 0, 0, 24);

-- ---------------------------------------------------------------------
-- 🥤 Bebidas
-- ---------------------------------------------------------------------
insert into products (name, category, price, sort_order) values
  ('Água 500ml',                          'bebida',  3.00, 1),
  ('Água Com Gás 500ml',                  'bebida',  4.00, 2),
  ('Guaravita',                           'bebida',  3.00, 3),
  ('Refrigerante Lata 350ml',             'bebida',  7.00, 4),
  ('Coca-Cola 1,5L',                      'bebida', 15.00, 5),
  ('Brahma Latão 473ml',                  'bebida',  8.00, 6),
  ('Heineken Latão 473ml',                'bebida', 10.00, 7),
  ('Copão Energético 500ml',              'bebida',  5.00, 8),
  ('Copão de Vodka ou Uísque + Energético','bebida', 10.00, 9);

-- ---------------------------------------------------------------------
-- ➕ Adicionais
--   O item de R$ 3,00 estava ilegível na foto — cadastrado como
--   'Adicional R$ 3,00' para ser renomeado depois sem perder histórico.
-- ---------------------------------------------------------------------
insert into products (name, category, price, meat_grams, sort_order) values
  ('Adicional R$ 3,00',  'extra',  3.00,   0, 1),
  ('Bacon',              'extra',  5.00,   0, 2),
  ('Calabresa',          'extra',  5.00,   0, 3),
  ('Linguiça Suína',     'extra',  7.00,   0, 4),
  ('Blend 100g',         'extra', 10.00, 100, 5);

-- 🎁 Promoção: combo batata + bebida por +R$ 15,00 sobre o hambúrguer
insert into products (name, category, price, sort_order) values
  ('Combo (batata + bebida)', 'extra', 15.00, 6);

-- ---------------------------------------------------------------------
-- Grupos de opção
-- ---------------------------------------------------------------------
do $$
declare
  g_queijo uuid;
  g_blend  uuid;
  g_versao uuid;
begin
  -- Queijo: opcional, sem acréscimo (cheddar OU muçarela)
  insert into option_groups (name, required, sort_order)
  values ('Queijo', false, 1) returning id into g_queijo;

  insert into option_values (group_id, name, price_delta, sort_order) values
    (g_queijo, 'Muçarela',  0, 1),
    (g_queijo, 'Cheddar',   0, 2),
    (g_queijo, 'Sem queijo',0, 3);

  -- Aplica a todos os hambúrgueres que levam queijo
  insert into product_option_groups (product_id, group_id)
  select id, g_queijo from products
  where name in (
    'A La Smash', 'A La Cheese', 'A La Cheese Duplo',
    'A L''Alho', 'A La Rings', 'A La Piña', 'A La Pancho', 'A La Crostini'
  );

  -- Blend do Duplo: 2×100g ou 1×200g — mesmo total de carne
  insert into option_groups (name, required, sort_order)
  values ('Blend', false, 2) returning id into g_blend;

  insert into option_values (group_id, name, price_delta, meat_delta, sort_order) values
    (g_blend, '2 blends de 100g', 0, 0, 1),
    (g_blend, '1 blend de 200g',  0, 0, 2);

  insert into product_option_groups (product_id, group_id)
  select id, g_blend from products where name = 'A La Cheese Duplo';

  -- Versão zero/normal para os refrigerantes
  insert into option_groups (name, required, sort_order)
  values ('Versão', true, 3) returning id into g_versao;

  insert into option_values (group_id, name, price_delta, sort_order) values
    (g_versao, 'Normal', 0, 1),
    (g_versao, 'Zero',   0, 2);

  insert into product_option_groups (product_id, group_id)
  select id, g_versao from products
  where name in ('Refrigerante Lata 350ml', 'Coca-Cola 1,5L');
end $$;
