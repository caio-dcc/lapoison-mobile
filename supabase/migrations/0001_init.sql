-- =====================================================================
-- La Viela — Hamburgueria | Schema inicial
-- Estratégia de performance: tabelas de RESUMO mantidas por trigger.
-- O app nunca agrega a tabela de vendas em tempo de leitura.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Produtos (catálogo dos selects de cadastro)
-- ---------------------------------------------------------------------
do $$ begin
  create type product_category as enum ('comida', 'bebida', 'extra');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_method as enum ('dinheiro', 'pix', 'credito', 'debito');
exception when duplicate_object then null; end $$;

create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    product_category not null,
  price       numeric(10,2) not null default 0 check (price >= 0),
  active      boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists products_category_active_idx
  on products (category, sort_order)
  where active;

-- ---------------------------------------------------------------------
-- Vendas
-- ---------------------------------------------------------------------
create table if not exists sales (
  id             uuid primary key default gen_random_uuid(),
  sold_at        timestamptz not null default now(),
  -- Data local (America/Sao_Paulo) — é por ela que o faturamento é fechado.
  sale_date      date not null default (now() at time zone 'America/Sao_Paulo')::date,
  customer_name  text,
  total          numeric(10,2) not null default 0 check (total >= 0),
  payment_method payment_method,
  note           text,
  created_at     timestamptz not null default now()
);

create index if not exists sales_sale_date_idx on sales (sale_date desc);

create table if not exists sale_items (
  id          uuid primary key default gen_random_uuid(),
  sale_id     uuid not null references sales(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  name        text not null,              -- snapshot: preserva histórico se o produto mudar
  category    product_category not null,  -- snapshot
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  quantity    int not null default 1 check (quantity > 0),
  subtotal    numeric(10,2) generated always as (unit_price * quantity) stored
);

create index if not exists sale_items_sale_id_idx on sale_items (sale_id);
create index if not exists sale_items_product_idx on sale_items (product_id);

-- ---------------------------------------------------------------------
-- RESUMO DIÁRIO — mantido por trigger, leitura O(1) por dia
-- ---------------------------------------------------------------------
create table if not exists daily_summary (
  sale_date    date primary key,
  total        numeric(12,2) not null default 0,
  sales_count  int not null default 0,
  food_total   numeric(12,2) not null default 0,
  drink_total  numeric(12,2) not null default 0,
  extra_total  numeric(12,2) not null default 0,
  updated_at   timestamptz not null default now()
);

create table if not exists monthly_summary (
  month        date primary key,          -- sempre o dia 1 do mês
  total        numeric(12,2) not null default 0,
  sales_count  int not null default 0,
  food_total   numeric(12,2) not null default 0,
  drink_total  numeric(12,2) not null default 0,
  extra_total  numeric(12,2) not null default 0,
  updated_at   timestamptz not null default now()
);

-- Recalcula um único dia (e o mês correspondente) a partir dos dados brutos.
create or replace function recalc_summary(target_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d_total numeric(12,2);
  d_count int;
  d_food  numeric(12,2);
  d_drink numeric(12,2);
  d_extra numeric(12,2);
  m_start date := date_trunc('month', target_date)::date;
begin
  select
    coalesce(sum(s.total), 0),
    count(*)
  into d_total, d_count
  from sales s
  where s.sale_date = target_date;

  select
    coalesce(sum(si.subtotal) filter (where si.category = 'comida'), 0),
    coalesce(sum(si.subtotal) filter (where si.category = 'bebida'), 0),
    coalesce(sum(si.subtotal) filter (where si.category = 'extra'),  0)
  into d_food, d_drink, d_extra
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.sale_date = target_date;

  if d_count = 0 then
    delete from daily_summary where sale_date = target_date;
  else
    insert into daily_summary as ds (sale_date, total, sales_count, food_total, drink_total, extra_total, updated_at)
    values (target_date, d_total, d_count, d_food, d_drink, d_extra, now())
    on conflict (sale_date) do update
      set total = excluded.total,
          sales_count = excluded.sales_count,
          food_total = excluded.food_total,
          drink_total = excluded.drink_total,
          extra_total = excluded.extra_total,
          updated_at = now();
  end if;

  -- Mês = soma dos dias já resumidos (barato: no máximo 31 linhas).
  insert into monthly_summary as ms (month, total, sales_count, food_total, drink_total, extra_total, updated_at)
  select
    m_start,
    coalesce(sum(total), 0),
    coalesce(sum(sales_count), 0),
    coalesce(sum(food_total), 0),
    coalesce(sum(drink_total), 0),
    coalesce(sum(extra_total), 0),
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
        updated_at = now();
end;
$$;

create or replace function trg_sales_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform recalc_summary(old.sale_date);
    return old;
  end if;

  perform recalc_summary(new.sale_date);
  if tg_op = 'UPDATE' and old.sale_date is distinct from new.sale_date then
    perform recalc_summary(old.sale_date);
  end if;
  return new;
end;
$$;

drop trigger if exists sales_summary_sync on sales;
create trigger sales_summary_sync
after insert or update or delete on sales
for each row execute function trg_sales_summary();

create or replace function trg_sale_items_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target date;
begin
  select s.sale_date into target
  from sales s
  where s.id = coalesce(new.sale_id, old.sale_id);

  if target is not null then
    perform recalc_summary(target);
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists sale_items_summary_sync on sale_items;
create trigger sale_items_summary_sync
after insert or update or delete on sale_items
for each row execute function trg_sale_items_summary();

-- ---------------------------------------------------------------------
-- RPC do Dashboard — 1 chamada, 1 payload, sem varrer sales
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
    -- Semana começando na segunda-feira
    (d - ((extract(isodow from d)::int - 1)))::date as week_start,
    date_trunc('month', d)::date as month_start,
    (date_trunc('month', d) - interval '1 month')::date as prev_month_start
  from today
)
select jsonb_build_object(
  'today_total',      coalesce((select total from daily_summary, bounds where sale_date = bounds.today), 0),
  'today_count',      coalesce((select sales_count from daily_summary, bounds where sale_date = bounds.today), 0),
  'week_total',       coalesce((select sum(total) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_count',       coalesce((select sum(sales_count) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'month_total',      coalesce((select total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_count',      coalesce((select sales_count from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_food',       coalesce((select food_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_drink',      coalesce((select drink_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_extra',      coalesce((select extra_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'prev_month_total', coalesce((select total from monthly_summary, bounds where month = bounds.prev_month_start), 0),
  'avg_ticket_month', coalesce((
      select case when sales_count > 0 then round(total / sales_count, 2) else 0 end
      from monthly_summary, bounds where month = bounds.month_start), 0),
  'last_7_days', coalesce((
      select jsonb_agg(jsonb_build_object('sale_date', gs.d, 'total', coalesce(ds.total, 0)) order by gs.d)
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
    ), '[]'::jsonb)
)
from bounds;
$$;

-- Resumo do mês para o calendário: só os dias com venda (payload mínimo).
-- DROP defensivo: se o banco já tinha uma versão anterior desta função
-- com uma assinatura de retorno diferente, o CREATE OR REPLACE sozinho
-- falha com "cannot change return type of existing function".
drop function if exists month_calendar(date);
create or replace function month_calendar(target_month date)
returns table (sale_date date, total numeric, sales_count int)
language sql
stable
security definer
set search_path = public
as $$
  select ds.sale_date, ds.total, ds.sales_count
  from daily_summary ds
  where ds.sale_date >= date_trunc('month', target_month)::date
    and ds.sale_date < (date_trunc('month', target_month) + interval '1 month')::date
  order by ds.sale_date;
$$;

-- Registro de venda atômico: cria a venda + itens e devolve o id.
create or replace function create_sale(
  p_customer_name  text,
  p_items          jsonb,
  p_payment_method payment_method default null,
  p_note           text default null,
  p_sale_date      date default null
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
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A venda precisa de pelo menos um item';
  end if;

  select coalesce(sum((i->>'unit_price')::numeric * (i->>'quantity')::int), 0)
  into v_total
  from jsonb_array_elements(p_items) i;

  insert into sales (customer_name, total, payment_method, note, sale_date)
  values (nullif(trim(coalesce(p_customer_name, '')), ''), v_total, p_payment_method, p_note, v_date)
  returning id into v_sale_id;

  insert into sale_items (sale_id, product_id, name, category, unit_price, quantity)
  select
    v_sale_id,
    nullif(i->>'product_id', '')::uuid,
    i->>'name',
    (i->>'category')::product_category,
    (i->>'unit_price')::numeric,
    (i->>'quantity')::int
  from jsonb_array_elements(p_items) i;

  return v_sale_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS — acesso liberado para a chave anônima (app interno dos donos).
-- Quando houver login, trocar `true` por `auth.role() = 'authenticated'`.
-- ---------------------------------------------------------------------
alter table products        enable row level security;
alter table sales           enable row level security;
alter table sale_items      enable row level security;
alter table daily_summary   enable row level security;
alter table monthly_summary enable row level security;

drop policy if exists "app read products" on products;
create policy "app read products" on products        for select using (true);
drop policy if exists "app write products" on products;
create policy "app write products" on products        for all    using (true) with check (true);
drop policy if exists "app read sales" on sales;
create policy "app read sales" on sales           for select using (true);
drop policy if exists "app write sales" on sales;
create policy "app write sales" on sales           for all    using (true) with check (true);
drop policy if exists "app read items" on sale_items;
create policy "app read items" on sale_items      for select using (true);
drop policy if exists "app write items" on sale_items;
create policy "app write items" on sale_items      for all    using (true) with check (true);
drop policy if exists "app read daily" on daily_summary;
create policy "app read daily" on daily_summary   for select using (true);
drop policy if exists "app read monthly" on monthly_summary;
create policy "app read monthly" on monthly_summary for select using (true);
