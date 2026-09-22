-- =====================================================================
-- 0007 — LUCRO
-- Custo por produto (editável na aba Produtos) e lucro por venda,
-- agregado nos resumos existentes. Segue a mesma estratégia do resto
-- do schema: nada é calculado em tempo de leitura.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Custo do produto
-- ---------------------------------------------------------------------
alter table products
  add column if not exists cost_price numeric(10,2) not null default 0 check (cost_price >= 0);

-- Snapshot do custo no item vendido: editar o custo do produto depois
-- não distorce o lucro histórico (mesmo princípio de name/category/unit_price).
alter table sale_items
  add column if not exists cost_price numeric(10,2) not null default 0 check (cost_price >= 0);

alter table sale_items
  add column if not exists profit numeric(12,2)
    generated always as ((unit_price - cost_price) * quantity) stored;

-- ---------------------------------------------------------------------
-- 2. Lucro nos resumos pré-agregados
-- ---------------------------------------------------------------------
alter table daily_summary
  add column if not exists profit numeric(12,2) not null default 0;

alter table monthly_summary
  add column if not exists profit numeric(12,2) not null default 0;

-- ---------------------------------------------------------------------
-- 3. Recalcula resumo diário/mensal — reaproveita a mesma função,
-- adicionando o agregado de lucro.
-- ---------------------------------------------------------------------
create or replace function recalc_summary(target_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d_total  numeric(12,2);
  d_count  int;
  d_food   numeric(12,2);
  d_drink  numeric(12,2);
  d_extra  numeric(12,2);
  d_meat   int;
  d_buns   int;
  d_profit numeric(12,2);
  m_start  date := date_trunc('month', target_date)::date;
begin
  select coalesce(sum(s.total), 0), count(*)
  into d_total, d_count
  from sales s
  where s.sale_date = target_date;

  select
    coalesce(sum(si.subtotal) filter (where si.category = 'comida'), 0),
    coalesce(sum(si.subtotal) filter (where si.category = 'bebida'), 0),
    coalesce(sum(si.subtotal) filter (where si.category = 'extra'),  0),
    coalesce(sum(si.meat_grams * si.quantity), 0),
    coalesce(sum(si.bun_count  * si.quantity), 0),
    coalesce(sum(si.profit), 0)
  into d_food, d_drink, d_extra, d_meat, d_buns, d_profit
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.sale_date = target_date;

  if d_count = 0 then
    if exists (select 1 from day_notes  where day = target_date)
    or exists (select 1 from day_photos where day = target_date) then
      update daily_summary
      set total = 0, sales_count = 0, food_total = 0, drink_total = 0,
          extra_total = 0, meat_grams = 0, bun_count = 0, profit = 0,
          updated_at = now()
      where sale_date = target_date;
    else
      delete from daily_summary where sale_date = target_date;
    end if;
  else
    insert into daily_summary as ds (
      sale_date, total, sales_count, food_total, drink_total, extra_total,
      meat_grams, bun_count, profit, updated_at
    )
    values (
      target_date, d_total, d_count, d_food, d_drink, d_extra,
      d_meat, d_buns, d_profit, now()
    )
    on conflict (sale_date) do update
      set total = excluded.total,
          sales_count = excluded.sales_count,
          food_total = excluded.food_total,
          drink_total = excluded.drink_total,
          extra_total = excluded.extra_total,
          meat_grams = excluded.meat_grams,
          bun_count = excluded.bun_count,
          profit = excluded.profit,
          updated_at = now();
  end if;

  insert into monthly_summary as ms (
    month, total, sales_count, food_total, drink_total, extra_total,
    meat_grams, bun_count, profit, updated_at
  )
  select
    m_start,
    coalesce(sum(total), 0),
    coalesce(sum(sales_count), 0),
    coalesce(sum(food_total), 0),
    coalesce(sum(drink_total), 0),
    coalesce(sum(extra_total), 0),
    coalesce(sum(meat_grams), 0),
    coalesce(sum(bun_count), 0),
    coalesce(sum(profit), 0),
    now()
  from daily_summary
  where sale_date >= m_start
    and sale_date < (m_start + interval '1 month')::date
  on conflict (month) do update
    set total = excluded.total,
        sales_count = excluded.sales_count,
        food_total = excluded.food_total,
        drink_total = excluded.drink_total,
        extra_total = excluded.extra_total,
        meat_grams = excluded.meat_grams,
        bun_count = excluded.bun_count,
        profit = excluded.profit,
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 4. create_sale grava o custo vigente do produto como snapshot
-- ---------------------------------------------------------------------
drop function if exists create_sale(text, jsonb, payment_method, text, date, uuid);

create or replace function create_sale(
  p_customer_name  text,
  p_items          jsonb,
  p_payment_method payment_method default null,
  p_note           text default null,
  p_sale_date      date default null,
  p_customer_id    uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_id uuid;
  v_total   numeric(10,2);
  v_date    date := coalesce(p_sale_date, (now() at time zone 'America/Sao_Paulo')::date);
  v_item    jsonb;
  v_item_id uuid;
  v_opt     jsonb;
  v_unit    numeric(10,2);
  v_cost    numeric(10,2);
  v_name    text := nullif(trim(coalesce(p_customer_name, '')), '');
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A venda precisa de pelo menos um item';
  end if;

  if p_customer_id is not null then
    select name into v_name from customers where id = p_customer_id;
    if v_name is null then
      raise exception 'Cliente não encontrado';
    end if;
  end if;

  select coalesce(sum(
    (
      (i->>'unit_price')::numeric
      + coalesce((
          select sum((o->>'price_delta')::numeric)
          from jsonb_array_elements(coalesce(i->'options', '[]'::jsonb)) o
        ), 0)
    ) * (i->>'quantity')::int
  ), 0)
  into v_total
  from jsonb_array_elements(p_items) i;

  insert into sales (customer_name, customer_id, total, payment_method, note, sale_date)
  values (v_name, p_customer_id, v_total, p_payment_method, p_note, v_date)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_unit := (v_item->>'unit_price')::numeric
      + coalesce((
          select sum((o->>'price_delta')::numeric)
          from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb)) o
        ), 0);

    -- Custo vigente do produto no momento da venda (snapshot).
    -- Se o item não referenciar um produto cadastrado (ex: venda avulsa
    -- sem product_id), o custo fica 0 e o lucro do item vira o valor cheio.
    v_cost := coalesce((
      select cost_price from products where id = nullif(v_item->>'product_id', '')::uuid
    ), 0);

    insert into sale_items (
      sale_id, product_id, name, category, unit_price, quantity,
      meat_grams, bun_count, cost_price
    )
    values (
      v_sale_id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'name',
      (v_item->>'category')::product_category,
      v_unit,
      (v_item->>'quantity')::int,
      coalesce((v_item->>'meat_grams')::int, 0)
        + coalesce((
            select sum((o->>'meat_delta')::int)
            from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb)) o
          ), 0),
      coalesce((v_item->>'bun_count')::int, 0),
      v_cost
    )
    returning id into v_item_id;

    for v_opt in
      select * from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb))
    loop
      insert into sale_item_options (sale_item_id, group_name, value_name, price_delta)
      values (
        v_item_id,
        v_opt->>'group_name',
        v_opt->>'value_name',
        coalesce((v_opt->>'price_delta')::numeric, 0)
      );
    end loop;
  end loop;

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Dashboard: lucro do mês/semana/dia
-- ---------------------------------------------------------------------
create or replace function dashboard_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with today as (
  select (now() at time zone 'America/Sao_Paulo')::date as d
),
bounds as (
  select
    d as today,
    (d - ((extract(isodow from d)::int - 1)))::date as week_start,
    date_trunc('month', d)::date as month_start,
    (date_trunc('month', d) - interval '1 month')::date as prev_month_start
  from today
)
select jsonb_build_object(
  'today_total',      coalesce((select total from daily_summary, bounds where sale_date = bounds.today), 0),
  'today_count',      coalesce((select sales_count from daily_summary, bounds where sale_date = bounds.today), 0),
  'today_meat',       coalesce((select meat_grams from daily_summary, bounds where sale_date = bounds.today), 0),
  'today_buns',       coalesce((select bun_count from daily_summary, bounds where sale_date = bounds.today), 0),
  'today_profit',     coalesce((select profit from daily_summary, bounds where sale_date = bounds.today), 0),

  'week_total',       coalesce((select sum(total) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_count',       coalesce((select sum(sales_count) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_meat',        coalesce((select sum(meat_grams) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_buns',        coalesce((select sum(bun_count) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_profit',      coalesce((select sum(profit) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),

  'month_total',      coalesce((select total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_count',      coalesce((select sales_count from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_food',       coalesce((select food_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_drink',      coalesce((select drink_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_extra',      coalesce((select extra_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_meat',       coalesce((select meat_grams from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_buns',       coalesce((select bun_count from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_profit',     coalesce((select profit from monthly_summary, bounds where month = bounds.month_start), 0),
  'prev_month_total', coalesce((select total from monthly_summary, bounds where month = bounds.prev_month_start), 0),
  'avg_ticket_month', coalesce((
      select case when sales_count > 0 then round(total / sales_count, 2) else 0 end
      from monthly_summary, bounds where month = bounds.month_start), 0),

  'last_7_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sale_date', gs.d,
        'total', coalesce(ds.total, 0),
        'meat_grams', coalesce(ds.meat_grams, 0)
      ) order by gs.d)
      from bounds,
           generate_series(bounds.today - 6, bounds.today, interval '1 day') as gs(d)
      left join daily_summary ds on ds.sale_date = gs.d::date
    ), '[]'::jsonb),

  'top_products', coalesce((
      select jsonb_agg(t)
      from (
        select si.name, si.category, sum(si.quantity)::int as qty, sum(si.subtotal) as total
        from sale_items si
        join sales s on s.id = si.sale_id, bounds
        where s.sale_date >= bounds.month_start
        group by si.name, si.category
        order by sum(si.subtotal) desc
        limit 5
      ) t
    ), '[]'::jsonb),

  'top_options', coalesce((
      select jsonb_agg(t)
      from (
        select sio.group_name, sio.value_name, sum(si.quantity)::int as qty
        from sale_item_options sio
        join sale_items si on si.id = sio.sale_item_id
        join sales s on s.id = si.sale_id, bounds
        where s.sale_date >= bounds.month_start
        group by sio.group_name, sio.value_name
        order by sio.group_name, sum(si.quantity) desc
      ) t
    ), '[]'::jsonb)
)
from bounds;
$$;

-- ---------------------------------------------------------------------
-- 6. Recalcula o histórico existente (custo passa a valer 0 até os
-- donos preencherem, então o lucro histórico começa em 0 e sobe
-- conforme os custos forem cadastrados nos produtos).
-- ---------------------------------------------------------------------
do $$
declare d date;
begin
  for d in select distinct sale_date from sales loop
    perform recalc_summary(d);
  end loop;
end $$;
