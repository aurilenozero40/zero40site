# Dtudo · Estoque e Vendas

Plataforma interna da Dtudo GPS e Acessórios: produtos com código de barras, clientes, PDV (venda no balcão),
controle de estoque, auditoria e dashboard do CEO. O **Telegram só notifica** o dono — nada é registrado por lá.

Next.js 16 (App Router) · Supabase (Postgres, Auth, Realtime) · Tailwind 4 · Vercel.

## Como uma venda funciona

```
Vendedor → Nova venda (bipa o código de barras) → Confirma
   → banco valida tudo (estoque, preço, desconto, juros, taxa) numa ÚNICA transação
   → baixa o estoque + grava a venda + registra a movimentação + auditoria
   → grava o evento SALE_COMPLETED na fila (na mesma transação)
   → serviço de notificações entrega no Telegram do CEO
```

- **O banco é a fonte da verdade.** O navegador só manda a intenção (produtos, quantidades, forma de pagamento);
  preço, desconto permitido, juros e taxa da operadora são calculados/validados no Postgres.
- **Produto com número de série (IMEI etc.):** marque "usa número de série" no cadastro do item. Na entrada de
  estoque e na venda, o fluxo vira bipar o código de barras do produto e, em seguida, o número de série de cada
  unidade — cada serial fica com status próprio (estoque/vendido/baixado) e volta ao estoque em cancelamento/devolução.
- **Entrada (troca):** no PDV, "Recebeu algo de entrada?" registra o produto usado que o cliente entregou e o
  valor abate o total da venda (fora do limite de desconto do vendedor). O produto entra automaticamente no
  estoque como **seminovo** (`condition`), com custo = valor da entrada; o gerente define o preço de venda depois.
  Cancelar a venda tira esse produto do estoque de novo — a menos que já tenha sido revendido.
- **Entrada de estoque em nota (vários produtos de uma vez):** em Movimentações → Nova, a entrada é um
  carrinho — bipe o código de barras de cada produto. Bipar o **mesmo produto do mesmo fornecedor** de
  novo só soma a quantidade na mesma linha (grupo); produto diferente, ou o mesmo produto com número de
  série, vira linha própria (individual, uma por unidade). Tudo é gravado numa única transação.
- **Fornecedor na entrada de estoque:** numa **compra**, o gerente escolhe o fornecedor uma vez — o produto
  "lembra" (`items.supplier_id`) e as próximas compras dele já vêm com o fornecedor preenchido, sem perguntar
  de novo (só troca se quiser). Cadastra fornecedor novo direto na tela, sem precisar de outra tela.
- **Duas pessoas vendendo a última unidade:** as linhas dos produtos são travadas; só uma consegue.
- **Retry/duplo clique não duplica nada:** cada venda tem uma chave de idempotência.
- **Telegram fora do ar não desfaz a venda:** o evento fica `pendente` na fila e é reenviado (com espera crescente).
- Venda nunca é apagada; movimentações, auditoria e pagamentos são imutáveis. Cancelar/devolver gera novas movimentações.

## Rodando localmente

```bash
npm install
cp .env.local.example .env.local   # preencha (veja abaixo)
npm run dev
```

## Banco de dados — `supabase/schema.sql` (arquivo único)

Cole o arquivo **inteiro** no SQL Editor do Supabase e execute. É idempotente: em banco novo cria tudo; em banco
existente só atualiza (sem apagar dados). **Toda mudança de banco entra nesse arquivo**, na seção certa.

Depois, em **Authentication → Users**, crie seu usuário e promova a CEO/admin:

```sql
update public.employees set role = 'ceo' where id = '<uuid do usuário>';
```

### Papéis

| | vendedor | gerente | admin / CEO |
|---|---|---|---|
| registrar venda, cadastrar cliente | ✔ | ✔ | ✔ |
| ver vendas | só as suas | todas | todas |
| desconto | limite (padrão 0%) | limite (padrão 100%) | até o valor da venda |
| cancelar venda / devolução | | ✔ | ✔ |
| cadastrar/editar produto e preço, movimentar estoque, relatórios | | ✔ | ✔ |
| funcionários, configurações | | | ✔ |

Os limites de desconto e de juros ficam em **Configurações** (admin/CEO).

## Variáveis de ambiente

Ver [.env.local.example](.env.local.example). Na Vercel: Project → Settings → Environment Variables.

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | conexão do navegador/servidor com o Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | **só servidor**: entrega de notificações e criação de funcionário. Nunca no navegador |
| `TELEGRAM_BOT_TOKEN` | token do bot (@BotFather) |
| `TELEGRAM_CEO_CHAT_ID` | chat que recebe os avisos |
| `TELEGRAM_WEBHOOK_SECRET` | valida o webhook do `/start` |
| `CRON_SECRET` | protege o reenvio automático (`/api/notifications/process`) |

## Telegram (só notificações)

1. Crie um bot no **@BotFather** e coloque o token em `TELEGRAM_BOT_TOKEN`.
2. Registre o webhook (só serve para o bot responder o seu chat ID quando você mandar `/start`):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
     -d "url=https://<seu-dominio>/api/telegram/webhook" \
     -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
   ```
3. Mande `/start` ao bot: ele responde o **chat ID**. Coloque em `TELEGRAM_CEO_CHAT_ID` e faça o redeploy.
4. Em **Configurações**, clique em *Enviar mensagem de teste* e escolha quais eventos o CEO recebe.

Eventos: venda realizada, venda cancelada, devolução, estoque baixo, produto esgotado, entrada de estoque.
Alerta de estoque dispara **uma vez** quando o produto vira (fica baixo/zera) — não repete a cada venda.

### Reenvio das notificações que falharam

Toda venda/movimentação já tenta entregar o que estiver pendente. Para garantir o reenvio mesmo sem movimento,
agende uma chamada a cada minuto em `GET /api/notifications/process` com `Authorization: Bearer <CRON_SECRET>`:

- **Vercel Cron** (`vercel.json`) — no plano gratuito só permite 1x por dia; use o Pro para 1x por minuto; ou
- **Supabase pg_cron + pg_net** (funciona em qualquer plano):
  ```sql
  select cron.schedule('reenviar-notificacoes', '* * * * *', $$
    select net.http_get(
      url := 'https://<seu-dominio>/api/notifications/process',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
    )
  $$);
  ```

## Testes

```bash
npm test          # tudo (unitários + banco)
npm run test:unit # cálculo de venda, mensagens, datas, CPF/CNPJ, papéis, serviço de notificações
npm run test:db   # regras do banco num Postgres REAL (sobe sozinho, nunca toca no Supabase)
```

Os testes de banco montam o **estado atual de produção** + o `schema.sql` novo por cima (o caminho real de
atualização) e também uma instalação do zero. Cobrem: venda (PIX, dinheiro, débito, crédito, parcelado com juros),
estoque insuficiente, **vendas simultâneas da última unidade**, idempotência, cancelamento, devolução, estoque
baixo/esgotado sem repetir, permissões (RLS), imutabilidade, auditoria, fila de notificações com retry e paridade
centavo-a-centavo entre o cálculo da tela e o do banco.

## Estrutura

```
supabase/schema.sql          fonte única do banco (tabelas, regras, RLS, funções de venda)
src/app/(app)/               telas: dashboard, vendas (PDV), clientes, itens, movimentações, relatórios, funcionários, configurações
src/app/api/                 employees · notifications/process (reenvio) · telegram/webhook (/start)
src/lib/sales/               cálculo de venda (espelho do banco), bandeiras, erros
src/lib/notifications/       eventos → templates → canal Telegram → serviço da fila (WhatsApp/e-mail entram como novos canais)
src/lib/auth/session.ts      usuário + papel da requisição (única fonte; o banco impõe a permissão)
tests/                       unit/ e db/
```
