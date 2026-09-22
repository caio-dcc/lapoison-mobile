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
    -- Ex.: "Caio Costa · 21/09 20:14" ou "Venda avulsa · 21/09 20:14"
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
