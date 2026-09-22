-- =====================================================================
-- LA VIELA — SETUP COMPLETO
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em Run.
-- E idempotente: pode ser rodado novamente sem erro.
-- Gerado a partir de supabase/migrations/ (0002 e um seed provisorio,
-- substituido pelo 0004, por isso nao entra aqui).
-- =====================================================================


-- #####################################################################
-- # ESQUEMA BASE
-- # (0001_init.sql)
-- #####################################################################

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

-- #####################################################################
-- # INSUMOS, VARIANTES E DIARIO
-- # (0003_insumos_variantes_diario.sql)
-- #####################################################################

-- =====================================================================
-- La Viela — Insumos (carne/pão), variantes (queijo, zero/normal)
--            e diário do dia (fotos + comentários)
-- Mesma estratégia: tudo que o dashboard lê já vem pré-agregado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. INSUMOS por produto
-- ---------------------------------------------------------------------
alter table products
  add column if not exists meat_grams int not null default 0
    check (meat_grams >= 0),
  add column if not exists bun_count int not null default 0
    check (bun_count >= 0);

comment on column products.meat_grams is
  'Gramas de carne consumidas por unidade vendida (ex.: Smash Duplo = 360).';
comment on column products.bun_count is
  'Pães consumidos por unidade vendida.';

-- Snapshot nos itens da venda: preserva o consumo histórico mesmo que
-- a ficha técnica do produto mude depois.
alter table sale_items
  add column if not exists meat_grams int not null default 0,
  add column if not exists bun_count int not null default 0;

-- ---------------------------------------------------------------------
-- 2. VARIANTES (grupos de opção)
--    Ex.: grupo "Queijo" -> mussarela | cheddar
--         grupo "Versão" -> normal | zero
-- ---------------------------------------------------------------------
create table if not exists option_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                 -- "Queijo", "Versão"
  required    boolean not null default true, -- obriga escolha na venda
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists option_values (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references option_groups(id) on delete cascade,
  name         text not null,                        -- "Mussarela", "Zero"
  price_delta  numeric(10,2) not null default 0,     -- 0 = sem acréscimo
  meat_delta   int not null default 0,               -- ajusta carne, se houver
  active       boolean not null default true,
  sort_order   int not null default 0
);

create index if not exists option_values_group_idx
  on option_values (group_id, sort_order) where active;

-- Quais grupos se aplicam a quais produtos
create table if not exists product_option_groups (
  product_id uuid not null references products(id) on delete cascade,
  group_id   uuid not null references option_groups(id) on delete cascade,
  primary key (product_id, group_id)
);

-- Opções escolhidas em cada item vendido (snapshot de nome/valor)
create table if not exists sale_item_options (
  id            uuid primary key default gen_random_uuid(),
  sale_item_id  uuid not null references sale_items(id) on delete cascade,
  group_name    text not null,
  value_name    text not null,
  price_delta   numeric(10,2) not null default 0
);

create index if not exists sale_item_options_item_idx
  on sale_item_options (sale_item_id);

-- ---------------------------------------------------------------------
-- 3. RESUMO DE INSUMOS — colunas novas nas tabelas de resumo
-- ---------------------------------------------------------------------
alter table daily_summary
  add column if not exists meat_grams int not null default 0,
  add column if not exists bun_count  int not null default 0;

alter table monthly_summary
  add column if not exists meat_grams int not null default 0,
  add column if not exists bun_count  int not null default 0;

-- ---------------------------------------------------------------------
-- 4. DIÁRIO DO DIA — fotos e comentários
-- ---------------------------------------------------------------------
create table if not exists day_notes (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists day_notes_day_idx on day_notes (day, created_at desc);

create table if not exists day_photos (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  storage_path text not null,       -- caminho no bucket 'day-photos'
  caption     text,
  created_at  timestamptz not null default now()
);

create index if not exists day_photos_day_idx on day_photos (day, created_at desc);

-- Contadores no resumo diário: o calendário mostra o marcador sem
-- precisar consultar as tabelas de notas/fotos.
alter table daily_summary
  add column if not exists notes_count  int not null default 0,
  add column if not exists photos_count int not null default 0;

-- O resumo do dia pode existir só por causa de uma nota/foto (sem venda).
create or replace function recalc_day_media(target_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n_count int;
  p_count int;
begin
  select count(*) into n_count from day_notes  where day = target_date;
  select count(*) into p_count from day_photos where day = target_date;

  if n_count = 0 and p_count = 0 then
    -- Remove a linha apenas se também não houver venda no dia.
    delete from daily_summary
    where sale_date = target_date and sales_count = 0;

    update daily_summary
    set notes_count = 0, photos_count = 0, updated_at = now()
    where sale_date = target_date;
  else
    insert into daily_summary as ds (sale_date, notes_count, photos_count, updated_at)
    values (target_date, n_count, p_count, now())
    on conflict (sale_date) do update
      set notes_count = excluded.notes_count,
          photos_count = excluded.photos_count,
          updated_at = now();
  end if;
end;
$$;

create or replace function trg_day_media_summary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform recalc_day_media(coalesce(new.day, old.day));
  return coalesce(new, old);
end;
$$;

drop trigger if exists day_notes_summary_sync on day_notes;
create trigger day_notes_summary_sync
after insert or update or delete on day_notes
for each row execute function trg_day_media_summary();

drop trigger if exists day_photos_summary_sync on day_photos;
create trigger day_photos_summary_sync
after insert or update or delete on day_photos
for each row execute function trg_day_media_summary();

-- Recalcula dia + mês, agora incluindo carne e pães.
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
  d_meat  int;
  d_buns  int;
  m_start date := date_trunc('month', target_date)::date;
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
    coalesce(sum(si.bun_count  * si.quantity), 0)
  into d_food, d_drink, d_extra, d_meat, d_buns
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.sale_date = target_date;

  if d_count = 0 then
    -- Sem vendas: zera os valores, mas preserva a linha se o dia tiver
    -- nota ou foto no diário (senão o marcador some do calendário).
    if exists (select 1 from day_notes  where day = target_date)
    or exists (select 1 from day_photos where day = target_date) then
      update daily_summary
      set total = 0, sales_count = 0, food_total = 0, drink_total = 0,
          extra_total = 0, meat_grams = 0, bun_count = 0, updated_at = now()
      where sale_date = target_date;
    else
      delete from daily_summary where sale_date = target_date;
    end if;
  else
    insert into daily_summary as ds (
      sale_date, total, sales_count, food_total, drink_total, extra_total,
      meat_grams, bun_count, updated_at
    )
    values (
      target_date, d_total, d_count, d_food, d_drink, d_extra,
      d_meat, d_buns, now()
    )
    on conflict (sale_date) do update
      set total = excluded.total,
          sales_count = excluded.sales_count,
          food_total = excluded.food_total,
          drink_total = excluded.drink_total,
          extra_total = excluded.extra_total,
          meat_grams = excluded.meat_grams,
          bun_count = excluded.bun_count,
          updated_at = now();
  end if;

  insert into monthly_summary as ms (
    month, total, sales_count, food_total, drink_total, extra_total,
    meat_grams, bun_count, updated_at
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
        updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- 5. create_sale atualizado: insumos + opções escolhidas
-- ---------------------------------------------------------------------
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
  v_item    jsonb;
  v_item_id uuid;
  v_opt     jsonb;
  v_unit    numeric(10,2);
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A venda precisa de pelo menos um item';
  end if;

  -- Total = (preço + soma dos acréscimos das opções) * quantidade
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

  insert into sales (customer_name, total, payment_method, note, sale_date)
  values (nullif(trim(coalesce(p_customer_name, '')), ''), v_total, p_payment_method, p_note, v_date)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_unit := (v_item->>'unit_price')::numeric
      + coalesce((
          select sum((o->>'price_delta')::numeric)
          from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb)) o
        ), 0);

    insert into sale_items (
      sale_id, product_id, name, category, unit_price, quantity,
      meat_grams, bun_count
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
      coalesce((v_item->>'bun_count')::int, 0)
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
-- 6. Dashboard com insumos
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

  'week_total',       coalesce((select sum(total) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_count',       coalesce((select sum(sales_count) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_meat',        coalesce((select sum(meat_grams) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),
  'week_buns',        coalesce((select sum(bun_count) from daily_summary, bounds where sale_date between bounds.week_start and bounds.today), 0),

  'month_total',      coalesce((select total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_count',      coalesce((select sales_count from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_food',       coalesce((select food_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_drink',      coalesce((select drink_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_extra',      coalesce((select extra_total from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_meat',       coalesce((select meat_grams from monthly_summary, bounds where month = bounds.month_start), 0),
  'month_buns',       coalesce((select bun_count from monthly_summary, bounds where month = bounds.month_start), 0),
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

  -- Opções mais escolhidas no mês (mussarela vs cheddar, zero vs normal)
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

-- Calendário com marcadores de nota/foto e insumos do dia.
-- DROP necessário: o tipo de retorno mudou (colunas novas).
drop function if exists month_calendar(date);
create or replace function month_calendar(target_month date)
returns table (
  sale_date    date,
  total        numeric,
  sales_count  int,
  meat_grams   int,
  bun_count    int,
  notes_count  int,
  photos_count int
)
language sql
stable
security definer
set search_path = public
as $$
  select ds.sale_date, ds.total, ds.sales_count,
         ds.meat_grams, ds.bun_count, ds.notes_count, ds.photos_count
  from daily_summary ds
  where ds.sale_date >= date_trunc('month', target_month)::date
    and ds.sale_date < (date_trunc('month', target_month) + interval '1 month')::date
  order by ds.sale_date;
$$;

-- Detalhe completo de um dia em UMA chamada: resumo + vendas + notas + fotos.
create or replace function day_detail(target_date date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select jsonb_build_object(
  'summary', coalesce((
    select to_jsonb(ds) from daily_summary ds where ds.sale_date = target_date
  ), jsonb_build_object(
    'sale_date', target_date, 'total', 0, 'sales_count', 0,
    'meat_grams', 0, 'bun_count', 0, 'notes_count', 0, 'photos_count', 0
  )),
  'sales', coalesce((
    select jsonb_agg(x order by x->>'sold_at' desc)
    from (
      select jsonb_build_object(
        'id', s.id,
        'sold_at', s.sold_at,
        'customer_name', s.customer_name,
        'total', s.total,
        'payment_method', s.payment_method,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', si.name,
            'category', si.category,
            'quantity', si.quantity,
            'unit_price', si.unit_price,
            'meat_grams', si.meat_grams,
            'options', coalesce((
              select jsonb_agg(jsonb_build_object(
                'group_name', sio.group_name,
                'value_name', sio.value_name
              ))
              from sale_item_options sio where sio.sale_item_id = si.id
            ), '[]'::jsonb)
          ))
          from sale_items si where si.sale_id = s.id
        ), '[]'::jsonb)
      ) as x
      from sales s
      where s.sale_date = target_date
    ) sub
  ), '[]'::jsonb),
  'notes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'body', n.body, 'created_at', n.created_at
    ) order by n.created_at desc)
    from day_notes n where n.day = target_date
  ), '[]'::jsonb),
  'photos', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'storage_path', p.storage_path,
      'caption', p.caption, 'created_at', p.created_at
    ) order by p.created_at desc)
    from day_photos p where p.day = target_date
  ), '[]'::jsonb)
);
$$;

-- ---------------------------------------------------------------------
-- 7. RLS das tabelas novas
-- ---------------------------------------------------------------------
alter table option_groups         enable row level security;
alter table option_values         enable row level security;
alter table product_option_groups enable row level security;
alter table sale_item_options     enable row level security;
alter table day_notes             enable row level security;
alter table day_photos            enable row level security;

drop policy if exists "app all option_groups" on option_groups;
create policy "app all option_groups" on option_groups for all using (true) with check (true);

drop policy if exists "app all option_values" on option_values;
create policy "app all option_values" on option_values for all using (true) with check (true);

drop policy if exists "app all product_option_groups" on product_option_groups;
create policy "app all product_option_groups" on product_option_groups for all using (true) with check (true);

drop policy if exists "app all sale_item_options" on sale_item_options;
create policy "app all sale_item_options" on sale_item_options for all using (true) with check (true);

drop policy if exists "app all day_notes" on day_notes;
create policy "app all day_notes" on day_notes for all using (true) with check (true);

drop policy if exists "app all day_photos" on day_photos;
create policy "app all day_photos" on day_photos for all using (true) with check (true);

-- ---------------------------------------------------------------------
-- 8. Recalcula os resumos existentes com as colunas novas
-- ---------------------------------------------------------------------
do $$
declare d date;
begin
  for d in select distinct sale_date from sales loop
    perform recalc_summary(d);
  end loop;
end $$;

-- #####################################################################
-- # CARDAPIO REAL DA CASA
-- # (0004_cardapio_real.sql)
-- #####################################################################

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

-- #####################################################################
-- # BUCKET DE FOTOS DO DIARIO
-- # (0005_storage_fotos.sql)
-- #####################################################################

-- =====================================================================
-- Bucket público para as fotos do diário
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('day-photos', 'day-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "day photos read" on storage.objects;
create policy "day photos read" on storage.objects
  for select using (bucket_id = 'day-photos');

drop policy if exists "day photos insert" on storage.objects;
create policy "day photos insert" on storage.objects
  for insert with check (bucket_id = 'day-photos');

drop policy if exists "day photos delete" on storage.objects;
create policy "day photos delete" on storage.objects
  for delete using (bucket_id = 'day-photos');

-- #####################################################################
-- # CLIENTES E RANKINGS
-- # (0006_clientes.sql)
-- #####################################################################

-- =====================================================================
-- 0006 — CLIENTES
-- Clientes são cadastrados antes das vendas e associados a elas.
-- customer_name continua em sales como snapshot histórico.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabela de clientes
-- ---------------------------------------------------------------------
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  phone       text,
  notes       text,
  birth_date  date,
  photo_path  text,               -- caminho no bucket customer-photos
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customers_name_idx   on customers (lower(name));
create index if not exists customers_active_idx on customers (active) where active;
-- Aniversariantes: busca por (mês, dia) sem depender do ano.
create index if not exists customers_birth_idx on customers (
  (extract(month from birth_date)), (extract(day from birth_date))
) where birth_date is not null;

create or replace function touch_customer_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists customers_touch on customers;
create trigger customers_touch
  before update on customers
  for each row execute function touch_customer_updated_at();

-- ---------------------------------------------------------------------
-- 2. Vínculo com vendas
-- ON DELETE SET NULL: apagar um cliente nunca apaga faturamento.
-- ---------------------------------------------------------------------
alter table sales
  add column if not exists customer_id uuid references customers(id) on delete set null;

create index if not exists sales_customer_idx on sales (customer_id)
  where customer_id is not null;

-- ---------------------------------------------------------------------
-- 3. Resumos por cliente — mantidos por trigger (leitura O(1))
-- Mesma estratégia das outras tabelas: nada é agregado na leitura.
-- ---------------------------------------------------------------------
create table if not exists customer_summary (
  customer_id  uuid primary key references customers(id) on delete cascade,
  total_spent  numeric(12,2) not null default 0,
  sales_count  int           not null default 0,
  meat_grams   int           not null default 0,
  first_sale   date,
  last_sale    date,
  updated_at   timestamptz   not null default now()
);

create index if not exists customer_summary_total_idx
  on customer_summary (total_spent desc);

-- Consumo cliente x produto — alimenta "quem mais consumiu cada item".
create table if not exists customer_product_summary (
  customer_id  uuid not null references customers(id) on delete cascade,
  product_name text not null,
  category     product_category not null,
  qty          int           not null default 0,
  total        numeric(12,2) not null default 0,
  last_at      date,
  primary key (customer_id, product_name)
);

create index if not exists cps_product_qty_idx
  on customer_product_summary (product_name, qty desc);

-- Recalcula os dois resumos de um cliente a partir das vendas reais.
create or replace function recalc_customer_summary(target_customer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if target_customer is null then
    return;
  end if;

  -- O cliente pode já ter sido apagado: o ON DELETE SET NULL em
  -- sales.customer_id dispara este recalc DEPOIS da remoção. Sem esta
  -- guarda, o insert abaixo viola a FK e impede apagar clientes.
  -- O cascade em customer_summary/customer_product_summary já limpou tudo.
  if not exists (select 1 from customers where id = target_customer) then
    return;
  end if;

  insert into customer_summary (
    customer_id, total_spent, sales_count, meat_grams,
    first_sale, last_sale, updated_at
  )
  select
    target_customer,
    coalesce(sum(s.total), 0),
    count(*)::int,
    coalesce((
      select sum(si.meat_grams * si.quantity)
      from sale_items si
      join sales s2 on s2.id = si.sale_id
      where s2.customer_id = target_customer
    ), 0)::int,
    min(s.sale_date),
    max(s.sale_date),
    now()
  from sales s
  where s.customer_id = target_customer
  on conflict (customer_id) do update set
    total_spent = excluded.total_spent,
    sales_count = excluded.sales_count,
    meat_grams  = excluded.meat_grams,
    first_sale  = excluded.first_sale,
    last_sale   = excluded.last_sale,
    updated_at  = now();

  -- Resumo por produto: recria o conjunto do cliente.
  delete from customer_product_summary where customer_id = target_customer;

  insert into customer_product_summary (
    customer_id, product_name, category, qty, total, last_at
  )
  select
    target_customer,
    si.name,
    si.category,
    sum(si.quantity)::int,
    sum(si.subtotal),
    max(s.sale_date)
  from sale_items si
  join sales s on s.id = si.sale_id
  where s.customer_id = target_customer
  group by si.name, si.category;
end;
$fn$;

-- Trigger em sales: cobre insert, troca de cliente e delete.
create or replace function sales_customer_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' and old.customer_id is distinct from new.customer_id then
    perform recalc_customer_summary(old.customer_id);
    perform recalc_customer_summary(new.customer_id);
  elsif tg_op = 'DELETE' then
    perform recalc_customer_summary(old.customer_id);
  else
    perform recalc_customer_summary(new.customer_id);
  end if;
  return null;
end;
$fn$;

drop trigger if exists sales_customer_summary_sync on sales;
create trigger sales_customer_summary_sync
  after insert or update or delete on sales
  for each row execute function sales_customer_sync();

-- Trigger em sale_items: os itens entram DEPOIS da venda, então o
-- resumo precisa ser refeito quando eles chegam.
create or replace function sale_items_customer_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_customer uuid;
  v_sale     uuid := coalesce(new.sale_id, old.sale_id);
begin
  select customer_id into v_customer from sales where id = v_sale;
  if v_customer is not null then
    perform recalc_customer_summary(v_customer);
  end if;
  return null;
end;
$fn$;

drop trigger if exists sale_items_customer_summary_sync on sale_items;
create trigger sale_items_customer_summary_sync
  after insert or update or delete on sale_items
  for each row execute function sale_items_customer_sync();

-- ---------------------------------------------------------------------
-- 4. create_sale com cliente
-- A assinatura antiga é removida para não deixar sobrecarga ambígua.
-- ---------------------------------------------------------------------
drop function if exists create_sale(text, jsonb, payment_method, text, date);

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
as $fn$
declare
  v_sale_id uuid;
  v_total   numeric(10,2);
  v_date    date := coalesce(p_sale_date, (now() at time zone 'America/Sao_Paulo')::date);
  v_item    jsonb;
  v_item_id uuid;
  v_opt     jsonb;
  v_unit    numeric(10,2);
  v_name    text := nullif(trim(coalesce(p_customer_name, '')), '');
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'A venda precisa de pelo menos um item';
  end if;

  -- Cliente informado por id: o nome cadastrado vira o snapshot.
  if p_customer_id is not null then
    select name into v_name from customers where id = p_customer_id;
    if v_name is null then
      raise exception 'Cliente não encontrado';
    end if;
  end if;

  -- Total = (preço + acréscimos das opções) * quantidade
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

    insert into sale_items (
      sale_id, product_id, name, category, unit_price, quantity,
      meat_grams, bun_count
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
      coalesce((v_item->>'bun_count')::int, 0)
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
$fn$;

-- ---------------------------------------------------------------------
-- 5. Rankings de clientes — 1 chamada, tudo pré-agregado
-- ---------------------------------------------------------------------
create or replace function customer_rankings(p_limit int default 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
select jsonb_build_object(
  -- Quem gastou mais no estabelecimento
  'top_spenders', coalesce((
      select jsonb_agg(t)
      from (
        select c.id, c.name, c.photo_path,
               cs.total_spent, cs.sales_count, cs.meat_grams, cs.last_sale,
               case when cs.sales_count > 0
                    then round(cs.total_spent / cs.sales_count, 2)
                    else 0 end as avg_ticket
        from customer_summary cs
        join customers c on c.id = cs.customer_id
        where cs.total_spent > 0
        order by cs.total_spent desc
        limit p_limit
      ) t
    ), '[]'::jsonb),

  -- Para cada produto, o cliente que mais consumiu
  'top_by_product', coalesce((
      select jsonb_agg(t order by t.qty desc)
      from (
        select distinct on (cps.product_name)
               cps.product_name, cps.category, cps.qty, cps.total,
               c.id as customer_id, c.name as customer_name, c.photo_path
        from customer_product_summary cps
        join customers c on c.id = cps.customer_id
        where cps.qty > 0
        order by cps.product_name, cps.qty desc, cps.total desc
      ) t
    ), '[]'::jsonb),

  'customers_count',  (select count(*)::int from customers where active),
  'with_sales_count', (select count(*)::int from customer_summary where sales_count > 0)
);
$fn$;

-- Ficha de um cliente: resumo + itens preferidos + últimas vendas.
create or replace function customer_detail(target_customer uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
select jsonb_build_object(
  'summary', coalesce((
      select to_jsonb(t) from (
        select cs.total_spent, cs.sales_count, cs.meat_grams,
               cs.first_sale, cs.last_sale,
               case when cs.sales_count > 0
                    then round(cs.total_spent / cs.sales_count, 2)
                    else 0 end as avg_ticket
        from customer_summary cs
        where cs.customer_id = target_customer
      ) t
    ), jsonb_build_object(
      'total_spent', 0, 'sales_count', 0, 'meat_grams', 0,
      'first_sale', null, 'last_sale', null, 'avg_ticket', 0
    )),

  'favorites', coalesce((
      select jsonb_agg(t order by t.qty desc)
      from (
        select product_name, category, qty, total
        from customer_product_summary
        where customer_id = target_customer
        order by qty desc
        limit 8
      ) t
    ), '[]'::jsonb),

  'recent_sales', coalesce((
      select jsonb_agg(t order by t.sold_at desc)
      from (
        select s.id, s.sold_at, s.sale_date, s.total, s.payment_method,
               coalesce((
                 select jsonb_agg(jsonb_build_object(
                   'name', si.name, 'quantity', si.quantity
                 ))
                 from sale_items si where si.sale_id = s.id
               ), '[]'::jsonb) as items
        from sales s
        where s.customer_id = target_customer
        order by s.sold_at desc
        limit 10
      ) t
    ), '[]'::jsonb)
);
$fn$;

-- ---------------------------------------------------------------------
-- 6. Backfill: liga vendas antigas por nome exato e popula os resumos
-- ---------------------------------------------------------------------
update sales s
set customer_id = c.id
from customers c
where s.customer_id is null
  and s.customer_name is not null
  and lower(trim(s.customer_name)) = lower(trim(c.name));

do $backfill$
declare
  r record;
begin
  for r in select id from customers loop
    perform recalc_customer_summary(r.id);
  end loop;
end $backfill$;

-- ---------------------------------------------------------------------
-- 7. Bucket de fotos dos clientes
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('customer-photos', 'customer-photos', true)
on conflict (id) do update set public = true;

drop policy if exists "customer photos read" on storage.objects;
create policy "customer photos read" on storage.objects
  for select using (bucket_id = 'customer-photos');

drop policy if exists "customer photos insert" on storage.objects;
create policy "customer photos insert" on storage.objects
  for insert with check (bucket_id = 'customer-photos');

drop policy if exists "customer photos delete" on storage.objects;
create policy "customer photos delete" on storage.objects
  for delete using (bucket_id = 'customer-photos');

-- ---------------------------------------------------------------------
-- 8. RLS
-- ---------------------------------------------------------------------
alter table customers                enable row level security;
alter table customer_summary         enable row level security;
alter table customer_product_summary enable row level security;

drop policy if exists "customers all" on customers;
create policy "customers all" on customers for all using (true) with check (true);

drop policy if exists "customer_summary read" on customer_summary;
create policy "customer_summary read" on customer_summary for select using (true);

drop policy if exists "customer_product_summary read" on customer_product_summary;
create policy "customer_product_summary read" on customer_product_summary
  for select using (true);

-- #####################################################################
-- # LUCRO POR PRODUTO E RESUMOS
-- # (0007_lucro.sql)
-- #####################################################################

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

-- #####################################################################
-- # AUDITORIA (CRUD) E OPERADOR NAS VENDAS
-- # (0008_auditoria.sql)
-- #####################################################################

-- =====================================================================
-- 0008 — AUDITORIA
-- Login por operador (Kaio / Matheus, sem senha por pessoa — a trava
-- de acesso do app já é a senha única) e trilha de auditoria de CRUD.
--
-- IMPORTANTE sobre o operador: testado e descartado o caminho de
-- `set_config` de sessão (GUC) — com PostgREST/Supabase cada chamada
-- da API roda em sua própria conexão do pool, então esse valor NUNCA
-- sobrevive entre uma chamada e outra. Por isso:
--   - `create_sale` recebe p_operator como parâmetro explícito e grava
--     tanto em audit_log quanto em sales.created_by — confiável.
--   - Clientes, produtos, notas e fotos continuam sendo auditados
--     (toda mudança é registrada, com old/new completos), mas o campo
--     `operator` fica nulo nessas tabelas por ora: escrevê-las hoje
--     passa por `.insert()`/`.update()` direto do supabase-js, sem
--     RPC. Uma extensão futura troca essas chamadas por RPCs
--     (upsert_customer, upsert_product, ...) recebendo o operador do
--     mesmo jeito que create_sale já faz.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabela de auditoria
-- ---------------------------------------------------------------------
create table if not exists audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  operator     text,                    -- 'Kaio' | 'Matheus' | null (desconhecido)
  table_name   text not null,
  operation    text not null,           -- 'INSERT' | 'UPDATE' | 'DELETE'
  row_id       text,                    -- id da linha afetada (texto: cobre uuid e bigint)
  summary      text,                    -- descrição curta e legível da mudança
  old_data     jsonb,
  new_data     jsonb
);

create index if not exists audit_log_at_idx on audit_log (at desc);
create index if not exists audit_log_table_idx on audit_log (table_name, at desc);
create index if not exists audit_log_operator_idx on audit_log (operator, at desc);

-- ---------------------------------------------------------------------
-- 2. Função de trigger genérica
-- Cada tabela auditada informa, via argumento do trigger, qual coluna
-- vira o "summary" (ex.: name, para produtos e clientes).
-- ---------------------------------------------------------------------
create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary_col text := tg_argv[0];
  v_row         record := coalesce(new, old);
  v_row_id      text;
  v_summary     text;
  v_operator    text;
begin
  begin
    v_row_id := (to_jsonb(v_row)->>'id');
  exception when others then
    v_row_id := null;
  end;

  if v_summary_col is not null then
    v_summary := to_jsonb(v_row)->>v_summary_col;
  end if;

  -- sales já grava o operador na própria linha (created_by), vindo de
  -- create_sale. As demais tabelas não têm essa coluna confiável ainda.
  if tg_table_name = 'sales' then
    v_operator := to_jsonb(v_row)->>'created_by';
  end if;

  insert into audit_log (
    operator, table_name, operation, row_id, summary, old_data, new_data
  )
  values (
    v_operator,
    tg_table_name,
    tg_op,
    v_row_id,
    v_summary,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Triggers nas tabelas de CRUD direto do usuário.
-- Tabelas só de resumo (daily_summary, customer_summary etc.) ficam de
-- fora de propósito: são derivadas, não decisões humanas — auditar
-- geraria ruído sem valor de rastreamento.
-- ---------------------------------------------------------------------
drop trigger if exists audit_products on products;
create trigger audit_products
  after insert or update or delete on products
  for each row execute function audit_row_change('name');

drop trigger if exists audit_customers on customers;
create trigger audit_customers
  after insert or update or delete on customers
  for each row execute function audit_row_change('name');

drop trigger if exists audit_sales on sales;
create trigger audit_sales
  after insert or update or delete on sales
  for each row execute function audit_row_change('customer_name');

drop trigger if exists audit_day_notes on day_notes;
create trigger audit_day_notes
  after insert or update or delete on day_notes
  for each row execute function audit_row_change('body');

drop trigger if exists audit_day_photos on day_photos;
create trigger audit_day_photos
  after insert or update or delete on day_photos
  for each row execute function audit_row_change('storage_path');

-- ---------------------------------------------------------------------
-- 4. create_sale/upsert de produto e cliente passam a aceitar o
-- operador diretamente como parâmetro — mais confiável do que depender
-- de GUC de sessão com PostgREST (cada request é uma conexão do pool).
-- ---------------------------------------------------------------------
alter table sales add column if not exists created_by text;

drop function if exists create_sale(text, jsonb, payment_method, text, date, uuid);

create or replace function create_sale(
  p_customer_name  text,
  p_items          jsonb,
  p_payment_method payment_method default null,
  p_note           text default null,
  p_sale_date      date default null,
  p_customer_id    uuid default null,
  p_operator       text default null
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

  insert into sales (customer_name, customer_id, total, payment_method, note, sale_date, created_by)
  values (v_name, p_customer_id, v_total, p_payment_method, p_note, v_date, p_operator)
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_unit := (v_item->>'unit_price')::numeric
      + coalesce((
          select sum((o->>'price_delta')::numeric)
          from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb)) o
        ), 0);

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
-- 6. Consulta de auditoria — paginada, mais recente primeiro.
-- ---------------------------------------------------------------------
create or replace function audit_feed(p_limit int default 50, p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select coalesce(jsonb_agg(t), '[]'::jsonb)
from (
  select id, at, operator, table_name, operation, row_id, summary
  from audit_log
  order by at desc
  limit p_limit offset p_offset
) t;
$$;

create or replace function audit_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from audit_log;
$$;

-- ---------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------
alter table audit_log enable row level security;

drop policy if exists "audit_log read" on audit_log;
create policy "audit_log read" on audit_log for select using (true);
-- Escrita só pelo trigger (security definer) — nenhuma policy de
-- insert/update/delete para o cliente, então a REST API não escreve
-- diretamente na tabela, apenas os triggers via função SECURITY DEFINER.

-- #####################################################################
-- # HORARIO/DIA NA AUDITORIA E PICO DE VENDAS
-- # (0009_auditoria_horario.sql)
-- #####################################################################

-- =====================================================================
-- 0009 — HORÁRIO E DIA DA VENDA NA AUDITORIA
-- sales já guardava sold_at (timestamp completo) e sale_date (dia do
-- fechamento), mas isso não aparecia de forma legível na trilha de
-- auditoria. Esta migration expõe os dois no resumo e como colunas
-- próprias no retorno de audit_feed, sem duplicar dado: continuam
-- vindo de old_data/new_data (jsonb), só ficam mais fáceis de ler.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Resumo de vendas na auditoria passa a incluir dia + horário,
-- não só o nome do cliente (que muitas vezes é vazio, venda avulsa).
-- ---------------------------------------------------------------------
create or replace function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_summary_col text := tg_argv[0];
  v_row         record := coalesce(new, old);
  v_row_id      text;
  v_summary     text;
  v_operator    text;
begin
  begin
    v_row_id := (to_jsonb(v_row)->>'id');
  exception when others then
    v_row_id := null;
  end;

  if tg_table_name = 'sales' then
    -- Ex.: "Kaio Costa · 21/09 20:14" ou "Venda avulsa · 21/09 20:14"
    v_summary := coalesce(nullif(trim(to_jsonb(v_row)->>'customer_name'), ''), 'Venda avulsa')
      || ' · ' || to_char((to_jsonb(v_row)->>'sold_at')::timestamptz at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI');
  elsif v_summary_col is not null then
    v_summary := to_jsonb(v_row)->>v_summary_col;
  end if;

  if tg_table_name = 'sales' then
    v_operator := to_jsonb(v_row)->>'created_by';
  end if;

  insert into audit_log (
    operator, table_name, operation, row_id, summary, old_data, new_data
  )
  values (
    v_operator,
    tg_table_name,
    tg_op,
    v_row_id,
    v_summary,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end
  );

  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. audit_feed passa a devolver sale_sold_at/sale_date quando a linha
-- é de sales — extraídos do jsonb já guardado, sem coluna nova.
-- ---------------------------------------------------------------------
create or replace function audit_feed(p_limit int default 50, p_offset int default 0)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select coalesce(jsonb_agg(t), '[]'::jsonb)
from (
  select
    id, at, operator, table_name, operation, row_id, summary,
    coalesce(new_data, old_data) ->> 'sold_at'   as sale_sold_at,
    coalesce(new_data, old_data) ->> 'sale_date' as sale_date
  from audit_log
  order by at desc
  limit p_limit offset p_offset
) t;
$$;

-- ---------------------------------------------------------------------
-- 3. Backfill: recalcula o summary das linhas de sales já existentes
-- na auditoria, para não deixar registros antigos sem o horário.
-- ---------------------------------------------------------------------
update audit_log
set summary = coalesce(nullif(trim(coalesce(new_data, old_data)->>'customer_name'), ''), 'Venda avulsa')
  || ' · ' || to_char(
       (coalesce(new_data, old_data)->>'sold_at')::timestamptz at time zone 'America/Sao_Paulo',
       'DD/MM HH24:MI'
     )
where table_name = 'sales'
  and coalesce(new_data, old_data) ? 'sold_at';

-- =====================================================================
-- HORÁRIO DE PICO DO DIA
-- Guardado em daily_summary (mantido por trigger, sem cálculo em
-- tempo de leitura): a hora do dia (0-23, fuso São Paulo) com maior
-- faturamento, e o total vendido naquela hora — para o dashboard
-- mostrar "pico às 20h · R$ 340,00" sem varrer sale_items na leitura.
-- =====================================================================
alter table daily_summary
  add column if not exists peak_hour  smallint,
  add column if not exists peak_total numeric(12,2) not null default 0;

-- recalc_summary passa a calcular o pico junto com o resto do resumo.
create or replace function recalc_summary(target_date date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d_total      numeric(12,2);
  d_count      int;
  d_food       numeric(12,2);
  d_drink      numeric(12,2);
  d_extra      numeric(12,2);
  d_meat       int;
  d_buns       int;
  d_profit     numeric(12,2);
  d_peak_hour  smallint;
  d_peak_total numeric(12,2);
  m_start      date := date_trunc('month', target_date)::date;
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

  -- Hora do dia (fuso local) com maior faturamento.
  select h.hour, h.total
  into d_peak_hour, d_peak_total
  from (
    select
      extract(hour from s.sold_at at time zone 'America/Sao_Paulo')::smallint as hour,
      sum(s.total) as total
    from sales s
    where s.sale_date = target_date
    group by 1
    order by sum(s.total) desc, 1
    limit 1
  ) h;

  if d_count = 0 then
    if exists (select 1 from day_notes  where day = target_date)
    or exists (select 1 from day_photos where day = target_date) then
      update daily_summary
      set total = 0, sales_count = 0, food_total = 0, drink_total = 0,
          extra_total = 0, meat_grams = 0, bun_count = 0, profit = 0,
          peak_hour = null, peak_total = 0, updated_at = now()
      where sale_date = target_date;
    else
      delete from daily_summary where sale_date = target_date;
    end if;
  else
    insert into daily_summary as ds (
      sale_date, total, sales_count, food_total, drink_total, extra_total,
      meat_grams, bun_count, profit, peak_hour, peak_total, updated_at
    )
    values (
      target_date, d_total, d_count, d_food, d_drink, d_extra,
      d_meat, d_buns, d_profit, d_peak_hour, coalesce(d_peak_total, 0), now()
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
          peak_hour = excluded.peak_hour,
          peak_total = excluded.peak_total,
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

-- Recalcula o histórico existente para preencher o pico dos dias já
-- fechados (sem isso, só dias novos teriam peak_hour).
do $$
declare d date;
begin
  for d in select distinct sale_date from sales loop
    perform recalc_summary(d);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Dashboard: horário de pico de HOJE.
-- Semana/mês não têm "hora do dia" única (são vários dias), então o
-- pico fica no nível diário — é onde a pergunta "que horas vende mais"
-- faz sentido de verdade.
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
  'today_peak_hour',  (select peak_hour from daily_summary, bounds where sale_date = bounds.today),
  'today_peak_total', coalesce((select peak_total from daily_summary, bounds where sale_date = bounds.today), 0),

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

  -- Dia (dos últimos 7) com o pico mais forte — vira o card
  -- "melhor horário da semana" no dashboard.
  'week_peak_hour', (
      select ds.peak_hour
      from daily_summary ds, bounds
      where ds.sale_date between bounds.week_start and bounds.today
        and ds.peak_hour is not null
      order by ds.peak_total desc
      limit 1
    ),
  'week_peak_total', coalesce((
      select ds.peak_total
      from daily_summary ds, bounds
      where ds.sale_date between bounds.week_start and bounds.today
        and ds.peak_hour is not null
      order by ds.peak_total desc
      limit 1
    ), 0),

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
-- Detalhe do horário de pico de um dia: itens vendidos e clientes
-- presentes naquela hora. 1 chamada, igual ao resto do app.
-- ---------------------------------------------------------------------
create or replace function peak_hour_detail(target_date date, target_hour int)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
select jsonb_build_object(
  'items', coalesce((
      select jsonb_agg(t order by t.total desc)
      from (
        select si.name, si.category, sum(si.quantity)::int as qty, sum(si.subtotal) as total
        from sale_items si
        join sales s on s.id = si.sale_id
        where s.sale_date = target_date
          and extract(hour from s.sold_at at time zone 'America/Sao_Paulo') = target_hour
        group by si.name, si.category
      ) t
    ), '[]'::jsonb),

  'customers', coalesce((
      select jsonb_agg(t order by t.sold_at desc)
      from (
        select distinct on (s.id)
               s.id, s.sold_at,
               coalesce(c.id, null) as customer_id,
               coalesce(nullif(trim(s.customer_name), ''), 'Venda avulsa') as customer_name,
               c.photo_path,
               s.total
        from sales s
        left join customers c on c.id = s.customer_id
        where s.sale_date = target_date
          and extract(hour from s.sold_at at time zone 'America/Sao_Paulo') = target_hour
      ) t
    ), '[]'::jsonb)
);
$$;
