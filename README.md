# Dtudo · Controle de Estoque

Plataforma interna de controle de estoque da Dtudo GPS e Acessórios. Next.js (App Router) + Supabase + Tailwind, deploy na Vercel.

## Rodando localmente

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Setup do backend (Supabase)

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Cole o conteúdo de [`supabase/schema.sql`](supabase/schema.sql) inteiro no SQL Editor do projeto e execute (idempotente — pode rodar de novo sem quebrar).
3. Em **Database → Replication**, confirme que a tabela `items` está habilitada (o schema já tenta habilitar via SQL).
4. Em **Authentication → Users**, crie seu usuário e promova a admin:
   ```sql
   update employees set role = 'admin' where id = '<seu-uuid>';
   ```
5. Copie [`.env.local.example`](.env.local.example) para `.env.local` e preencha as chaves do projeto (Project Settings → API).

## Bot do Telegram (opcional)

Crie um bot via [@BotFather](https://t.me/BotFather), preencha `TELEGRAM_BOT_TOKEN` e `TELEGRAM_WEBHOOK_SECRET` no `.env.local`/nas env vars da Vercel, e depois do deploy registre o webhook:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<seu-dominio>/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

## Deploy

Importe este repositório na [Vercel](https://vercel.com/new), configure as env vars (mesmas do `.env.local`) e faça o deploy.
