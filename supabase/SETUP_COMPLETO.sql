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
