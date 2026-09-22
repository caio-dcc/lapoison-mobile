-- =====================================================================
-- ZERAR PARA PRODUÇÃO
--
-- Apaga TODOS os dados de teste (vendas, clientes, notas, fotos,
-- resumos e auditoria) e deixa o banco pronto para o primeiro dia real
-- de operação. O CARDÁPIO (products) NÃO é apagado — é a configuração
-- da casa, não um dado de teste.
--
-- ATENÇÃO: isso é irreversível. Rode só quando tiver certeza de que
-- não quer mais nenhuma venda/cliente de teste no histórico.
--
-- IMPORTANTE: rode o supabase/SETUP_COMPLETO.sql primeiro (uma vez).
-- Este script é defensivo — cada tabela só é apagada se já existir —
-- mas as funções/triggers de resumo (recalc_summary etc.) só existem
-- depois do SETUP_COMPLETO.
--
-- Como rodar: SQL Editor do Supabase → cole este arquivo inteiro → Run.
-- =====================================================================

do $$
begin
  -- Ordem importa por causa das foreign keys (filhos antes dos pais).
  if to_regclass('public.sale_item_options') is not null then
    delete from sale_item_options;
  end if;
  if to_regclass('public.sale_items') is not null then
    delete from sale_items;
  end if;
  if to_regclass('public.sales') is not null then
    delete from sales;
  end if;

  if to_regclass('public.customer_product_summary') is not null then
    delete from customer_product_summary;
  end if;
  if to_regclass('public.customer_summary') is not null then
    delete from customer_summary;
  end if;
  if to_regclass('public.customers') is not null then
    delete from customers;
  end if;

  if to_regclass('public.day_photos') is not null then
    delete from day_photos;
  end if;
  if to_regclass('public.day_notes') is not null then
    delete from day_notes;
  end if;

  if to_regclass('public.daily_summary') is not null then
    delete from daily_summary;
  end if;
  if to_regclass('public.monthly_summary') is not null then
    delete from monthly_summary;
  end if;

  if to_regclass('public.audit_log') is not null then
    delete from audit_log;
  end if;
end $$;

-- Fotos já enviadas para os buckets (day-photos, customer-photos)
-- continuam no Storage — apagar os arquivos é uma ação separada no
-- painel do Supabase (Storage → bucket → selecionar tudo → Delete),
-- porque o SQL Editor não tem acesso aos arquivos, só às tabelas.

-- Confirma que ficou vazio (0 em tudo, exceto produtos_mantidos).
-- audit_log usa EXECUTE porque o nome só existe se 0008 já foi
-- aplicado — um SELECT estático seria validado mesmo dentro de um
-- CASE e quebraria em bancos sem essa tabela.
do $$
declare
  v_vendas    int;
  v_clientes  int;
  v_notas     int;
  v_fotos     int;
  v_auditoria int := 0;
  v_produtos  int;
begin
  select count(*) into v_vendas   from sales;
  select count(*) into v_clientes from customers;
  select count(*) into v_notas    from day_notes;
  select count(*) into v_fotos    from day_photos;
  select count(*) into v_produtos from products;

  if to_regclass('public.audit_log') is not null then
    execute 'select count(*) from audit_log' into v_auditoria;
  end if;

  raise notice 'vendas=% clientes=% notas=% fotos=% auditoria=% produtos_mantidos=%',
    v_vendas, v_clientes, v_notas, v_fotos, v_auditoria, v_produtos;
end $$;
