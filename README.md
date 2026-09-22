# La Viela — App de Gestão

App mobile (Expo / React Native) para os donos acompanharem a operação da
hamburgueria: faturamento, consumo de insumos, registro de vendas,
clientes, calendário com diário de fotos e cadastro de produtos.

---

## 1. Aplicar o banco (fazer UMA vez)

1. Abra o **SQL Editor** do projeto:
   https://supabase.com/dashboard/project/tblqjdfpmpvaiuyjwqqi/sql/new
2. Copie todo o conteúdo de [`supabase/SETUP_COMPLETO.sql`](supabase/SETUP_COMPLETO.sql)
3. Cole e clique em **Run**.

Isso cria tabelas, triggers de resumo, funções, os buckets de fotos e já
carrega o cardápio real da casa. O script é **idempotente**: pode ser
rodado de novo sem erro, mesmo sobre um banco que já tinha versão antiga.

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

## 3. Senha de acesso

O app abre numa tela de senha. A senha inicial é:

```
gtxMrj2@
```

8 caracteres, gerada por CSPRNG, sem caracteres ambíguos (0/O, 1/l/I)
para não errar ao digitar. Fica guardada no **expo-secure-store**
(Keychain no iOS / Keystore no Android), nunca em armazenamento comum.
Depois de desbloquear, o app não pede senha de novo por 30 minutos.

Para trocar, chame `setPassword()` de
[`src/lib/auth.ts`](src/lib/auth.ts) — a senha nova passa a valer no
lugar da inicial, sem mexer no código.

> Isso é uma **trava de acesso ao aparelho**, não autenticação de
> servidor: a chave do Supabase continua sendo a publishable. Para
> multiusuário de verdade, o caminho é Supabase Auth + RLS por usuário.

---

## As 5 abas

Ícones: [lucide-react-native](https://lucide.dev) (traço 1.9, via
`react-native-svg`), centralizados em
[`src/components/icons.tsx`](src/components/icons.tsx).
**Nenhum emoji ou glifo de texto é usado como ícone em nenhum lugar.**

| Ícone | Aba | Conteúdo |
|---|---|---|
| `LayoutDashboard` | **Dashboard** | Faturamento mensal/semanal/diário, consumo de carne e pães, tendência de 7 dias, mix de categorias, top produtos, preferências e **rankings de clientes** |
| `Hamburger` | **Registro** | Seleção por categoria com variantes, **cliente associado**, pagamento, resumo com total de carne/pães |
| `Users` | **Clientes** | Grid com fotos, cadastro (nome, número, informações extras, nascimento), ficha com histórico e aniversariantes do mês |
| `CalendarDays` | **Calendário** | Grade mensal por intensidade de faturamento. Toque no dia abre **Vendas** e **Diário** (fotos + anotações) |
| `ClipboardList` | **Produtos** | Cadastro e edição de itens com ficha técnica (gramas de carne, pães) |

## Navegação

- **Swipe** para esquerda/direita troca de aba (`Gesture.Pan` do
  gesture-handler + trilho animado em Reanimated). O gesto usa
  `activeOffsetX`/`failOffsetY` para **não roubar a rolagem vertical**
  das listas.
- Toque na barra flutuante também navega, com a mesma animação de slide.
- A barra é de **vidro translúcido** (`expo-blur`) com espaçamento
  ampliado entre os ícones.

## Clientes

Cadastrados **antes** das vendas e associados a elas:

- `sales.customer_id` referencia `customers` com **`on delete set null`**:
  remover um cliente **nunca apaga faturamento**.
- `sales.customer_name` continua preenchido como **snapshot** — o
  histórico permanece legível mesmo sem o cadastro.
- Na venda, o cliente pode ser escolhido da lista ou **cadastrado na
  hora** digitando o nome na busca.
- Fotos vão para o bucket `customer-photos`.

No dashboard, duas abas:

- **Quem gastou mais** — ranking por valor total, com ticket médio.
- **Por item** — para cada produto, o cliente que mais consumiu.

Ambas leem tabelas **pré-agregadas por trigger**
(`customer_summary`, `customer_product_summary`), então o ranking não
varre a tabela de vendas.

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

Fotos vão para o bucket `day-photos`; anotações para `day_notes`. O
calendário marca com um ponto os dias que têm registro, usando
contadores já materializados — sem consulta extra.

## Desempenho

Nenhuma tela agrega a tabela de vendas em tempo de leitura:

- **Dashboard** → 2 RPCs em paralelo (`dashboard_overview` + `customer_rankings`)
- **Calendário** → só dias com movimento (`month_calendar`)
- **Dia** → 1 RPC (`day_detail`) traz resumo + vendas + notas + fotos
- **Cliente** → 1 RPC (`customer_detail`) traz resumo + preferidos + compras
- Cache em memória de 60s evita refetch ao trocar de aba
- Telas já visitadas continuam montadas

## Aparência

| Cor | Hex | Uso |
|---|---|---|
| Shadow Grey | `#272727` | Fundo |
| Porcelain | `#FCFFFC` | Detalhes, ícones e fontes |

Paleta **monocromática, sem verde**. A hierarquia visual vem de
opacidade e transparência (`alpha.p04` … `alpha.p80` em
[`src/theme/index.ts`](src/theme/index.ts)), não de cor. Superfícies são
translúcidas com efeito de vidro.

**Fontes** (via `@expo-google-fonts`, carregadas com `useFonts`):

- **Space Grotesk** — títulos e números (geométrica, moderna)
- **Inter** — texto corrido (legível em corpo pequeno)

O splash fica retido até as fontes carregarem, então não há flash de
texto sem fonte.

### Sobre o blur no Android

No SDK 57, o `BlurView` só desfoca de verdade no Android a partir do
**SDK 31** e apenas com `blurMethod` explícito — sem isso ele renderiza
uma `View` semitransparente. Por isso as superfícies de vidro em
[`src/components/Glass.tsx`](src/components/Glass.tsx) têm cor de fundo
própria: **ficam corretas mesmo sem desfoque nenhum**.

## Comemoração ao fechar venda

Confete + som + vibração:

- **Confete**: implementação própria em Reanimated
  ([`src/components/Confetti.tsx`](src/components/Confetti.tsx)), ~80
  linhas na UI thread. As libs de confete conhecidas são pré-Fabric e sem
  manutenção desde 2022; o Expo Go também não carrega módulos nativos
  próprios.
- **Som**: arpejo de Dó maior sintetizado em
  `assets/sfx/success.wav`, tocado com **expo-audio**
  (`expo-av` foi removido do SDK 57).
- **Vibração**: `expo-haptics`, sempre fire-and-forget — nunca bloqueia
  a UI nem derruba o app se falhar.

## Testes

```bash
npm test        # 35 testes de lógica de negócio
npm run typecheck
```

A lógica de cálculo vive em [`src/lib/metrics.ts`](src/lib/metrics.ts),
separada da UI e coberta por testes: formatação, insumos, totais por
categoria, ticket médio e cenários de turno completo.

O SQL foi validado rodando o script inteiro num Postgres 17 real
(container descartável), incluindo casos destrutivos: apagar uma venda,
apagar um cliente com vendas e venda sem cliente.

## Pendências do cardápio

- **Adicional de R$ 3,00**: estava ilegível na foto (reflexo do flash).
  Cadastrado como `Adicional R$ 3,00` — renomeie na aba **Produtos**
  sem perder histórico.
- A promoção "combo batata + bebida +R$ 15,00" está como item extra
  `Combo (batata + bebida)`.
- As variantes (muçarela × cheddar, zero × normal) estão com
  `price_delta` zerado, aguardando a tabela de preços.

## Segurança

O app usa apenas a **publishable key** (`.env`, fora do Git). A RLS está
liberada para essa chave, adequado a um app interno dos donos. Ao
entregar ao cliente, adicione Supabase Auth e restrinja as policies para
`auth.role() = 'authenticated'`.

> A `sb_secret_...` do projeto passou por chat durante o
> desenvolvimento. **Rotacione essa chave** no dashboard do Supabase.
> Ela nunca foi gravada em nenhum arquivo do projeto.
