-- =====================================================================
-- Catálogo provisório. SUBSTITUIR pela lista real do cliente.
-- Para recarregar: delete from products; e rode este arquivo de novo.
-- =====================================================================

insert into products (name, category, price, sort_order) values
  -- Hambúrgueres
  ('X-Salada',            'comida', 22.00, 1),
  ('X-Bacon',             'comida', 26.00, 2),
  ('X-Tudo',              'comida', 32.00, 3),
  ('Smash Duplo',         'comida', 29.00, 4),
  ('Cheeseburger',        'comida', 19.00, 5),
  ('Burger Vegetariano',  'comida', 25.00, 6),
  ('Batata Frita',        'comida', 15.00, 7),

  -- Bebidas
  ('Cerveja Long Neck',   'bebida',  10.00, 1),
  ('Cerveja 600ml',       'bebida',  16.00, 2),
  ('Chopp 300ml',         'bebida',  12.00, 3),
  ('Refrigerante Lata',   'bebida',   7.00, 4),
  ('Água Mineral',        'bebida',   4.00, 5),
  ('Suco Natural',        'bebida',   9.00, 6),

  -- Extras
  ('Bacon Extra',         'extra',    5.00, 1),
  ('Cheddar Extra',       'extra',    4.00, 2),
  ('Ovo',                 'extra',    3.00, 3),
  ('Molho Especial',      'extra',    3.00, 4),
  ('Embalagem Delivery',  'extra',    2.00, 5);
