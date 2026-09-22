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
