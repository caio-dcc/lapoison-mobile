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
