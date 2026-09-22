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
-- Como rodar: SQL Editor do Supabase → cole este arquivo inteiro → Run.
-- =====================================================================

-- Ordem importa por causa das foreign keys (filhos antes dos pais).
delete from sale_item_options;
delete from sale_items;
delete from sales;

delete from customer_product_summary;
delete from customer_summary;
delete from customers;

delete from day_photos;
delete from day_notes;

delete from daily_summary;
delete from monthly_summary;

delete from audit_log;

-- Fotos já enviadas para os buckets (day-photos, customer-photos)
-- continuam no Storage — apagar os arquivos é uma ação separada no
-- painel do Supabase (Storage → bucket → selecionar tudo → Delete),
-- porque o SQL Editor não tem acesso aos arquivos, só às tabelas.

-- Confirma que ficou vazio:
select
  (select count(*) from sales)            as vendas,
  (select count(*) from customers)        as clientes,
  (select count(*) from day_notes)        as notas,
  (select count(*) from day_photos)       as fotos,
  (select count(*) from audit_log)        as auditoria,
  (select count(*) from products)         as produtos_mantidos;
