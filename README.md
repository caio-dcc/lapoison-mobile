# La Viela — App de Gestão

App mobile (Expo / React Native) para os donos acompanharem a operação da
hamburgueria: faturamento, consumo de insumos, registro de vendas,
calendário com diário de fotos e cadastro de produtos.

---

## 1. Aplicar o banco (fazer UMA vez)

1. Abra o **SQL Editor** do projeto:
   https://supabase.com/dashboard/project/tblqjdfpmpvaiuyjwqqi/sql/new
2. Copie todo o conteúdo de [`supabase/SETUP_COMPLETO.sql`](supabase/SETUP_COMPLETO.sql)
3. Cole e clique em **Run**.

Isso cria tabelas, triggers de resumo, funções, o bucket de fotos e já
carrega o cardápio real da casa.

## 2. Rodar no Expo Go

```bash
npm start
```

Leia o QR code com o **Expo Go** (Android) ou a câmera (iOS).
O celular precisa estar na **mesma rede Wi-Fi** do PC.

Se a rede bloquear, use o túnel:

```bash
npx expo start --tunnel
```

> Após alterar o `.env`, reinicie com `npx expo start --clear`.

---

## As 4 abas

Ícones: [lucide-react-native](https://lucide.dev) (traço 1.9, via `react-native-svg`),
centralizados em [`src/components/icons.tsx`](src/components/icons.tsx).

| Ícone | Aba | Conteúdo |
|---|---|---|
| `LayoutDashboard` | **Dashboard** | Faturamento mensal/semanal/diário, consumo de carne e pães nos 3 períodos, tendência de 7 dias, mix de categorias, top produtos e preferências (muçarela × cheddar, zero × normal) |
| `Hamburger` | **Registro** | Seleção por categoria com escolha de variantes, nome do cliente, pagamento, resumo com total de carne/pães |
| `CalendarDays` | **Calendário** | Grade mensal por intensidade de faturamento, navegação entre meses. Toque no dia abre **Vendas** e **Diário** (fotos + anotações) |
| `ClipboardList` | **Produtos** | Cadastro e edição de itens com ficha técnica (gramas de carne, pães) |

## Insumos

Cada produto guarda `meat_grams` e `bun_count`. A cada venda o consumo é
somado automaticamente nos resumos, então o dashboard mostra carne e pães
por dia, semana e mês sem nenhum cálculo em tempo de leitura.

A ficha técnica é **snapshot** no item vendido: alterar o produto depois
não distorce o histórico.

## Variantes

Grupos de opção (`option_groups`) ligados a produtos:

- **Queijo** (opcional): Muçarela · Cheddar · Sem queijo
- **Blend** (A La Cheese Duplo): 2×100g ou 1×200g
- **Versão** (refrigerantes): Normal · Zero

Cada opção admite acréscimo de preço (`price_delta`) e ajuste de carne
(`meat_delta`) — hoje ambos zerados, conforme o cardápio.

## Diário do dia

Fotos vão para o bucket `day-photos` do Supabase Storage; anotações para
`day_notes`. O calendário marca com um ponto os dias que têm registro,
usando contadores já materializados — sem consulta extra.

## Desempenho

Nenhuma tela agrega a tabela de vendas em tempo de leitura:

- **Dashboard** → 1 RPC (`dashboard_overview`), payload pré-agregado
- **Calendário** → só dias com movimento (`month_calendar`)
- **Dia** → 1 RPC (`day_detail`) traz resumo + vendas + notas + fotos
- Cache em memória de 60s evita refetch ao trocar de aba
- Telas já visitadas continuam montadas

## Paleta

| Cor | Hex | Uso |
|---|---|---|
| Shadow Grey | `#272727` | Superfícies |
| Forest Green | `#248232` | Verde profundo |
| Medium Jungle | `#2BA84A` | Acento, item ativo |
| Porcelain | `#FCFFFC` | Texto |

## Pendências do cardápio

- **Adicional de R$ 3,00**: estava ilegível na foto (reflexo do flash).
  Cadastrado como `Adicional R$ 3,00` — renomeie na aba **Produtos**
  sem perder histórico.
- A promoção "combo batata + bebida +R$ 15,00" está como item extra
  `Combo (batata + bebida)`.

## Segurança

O app usa apenas a **publishable key** (`.env`, fora do Git). A RLS está
liberada para essa chave, adequado a um app interno dos donos. Ao entregar
ao cliente, adicione login e restrinja as policies para
`auth.role() = 'authenticated'`.
