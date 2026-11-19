# Atendimento em análise técnica - PGMs

Painel para acompanhar links de atendimentos que estão com a equipe técnica:
em aberto da semana, pendentes de semanas anteriores e histórico de resolvidos.

- Front-end estático (`public/`) + funções serverless da Vercel (`api/`)
- Dados no **Upstash Redis** (integração do Marketplace da Vercel, plano gratuito)
- Acesso protegido por **senha única da equipe**
- A tela **atualiza sozinha a cada 15 segundos** (e na hora em que você volta para a aba) para todos que estão com o painel aberto

## Publicar na Vercel (uns 10 minutos)

1. **Suba o código para um repositório no GitHub** (pode ser privado).
2. Na Vercel: **Add New → Project** → importe o repositório.
   Framework Preset: **Other**. Não precisa mudar build nem output.
3. Antes de clicar em Deploy, abra **Environment Variables** e crie:
   - `APP_PASSWORD` = a senha que a equipe vai usar
4. Clique em **Deploy**.
5. No projeto criado, vá em **Storage → Create Database → Upstash (Redis)**,
   escolha a região mais próxima (ex.: `sa-east-1` São Paulo), plano Free,
   e conecte ao projeto. A Vercel cria sozinha as variáveis
   `KV_REST_API_URL` e `KV_REST_API_TOKEN`.
6. Vá em **Deployments → ⋯ → Redeploy** para o projeto ler as novas variáveis.

Pronto: abra a URL, informe seu nome e a senha da equipe.

### Atualizações automáticas do código

Com o projeto ligado ao GitHub, todo `git push` na branch principal
publica uma nova versão automaticamente. Pushes em outras branches geram
URLs de pré-visualização.

## Como usar

- **+ Novo atendimento**: link, descrição do que está ocorrendo e equipe responsável.
- **Concluir**: move para o histórico de resolvidos, com nota opcional de solução,
  data, quem concluiu e quanto tempo levou.
- **Reabrir**: volta um resolvido para a lista em aberto.
- **Excluir**: apaga de vez (use só para registros incluídos por engano).
- Semana considerada: **segunda a domingo**.

## Trocar a senha

Altere `APP_PASSWORD` em Settings → Environment Variables e faça Redeploy.
Todas as sessões antigas deixam de valer e cada pessoa entra de novo com a senha nova.

## Rodar localmente (opcional)

```bash
npm install
npm i -g vercel
vercel link          # liga a pasta ao projeto da Vercel
vercel env pull      # baixa as variáveis para .env.local
vercel dev           # abre em http://localhost:3000
```

Para testar sem banco, use `ALLOW_MEMORY_STORE=1` e `APP_PASSWORD=teste`
(os dados somem ao reiniciar).

## Estrutura

```
api/login.js               POST entra, DELETE sai, GET verifica sessão
api/atendimentos/index.js  GET lista, POST cria
api/atendimentos/[id].js   PATCH (edit | resolve | reopen), DELETE
lib/                       autenticação, validação e acesso ao Redis
public/index.html, app.js  interface
```

## Limites

- O nome de quem incluiu ou concluiu é o que cada pessoa digita ao entrar
  (fica salvo no navegador). Não há contas individuais, só a senha da equipe.
- Consumo do Upstash: cada navegador com o painel visível gasta 1 comando a cada 15 s
  (a lista completa só é buscada quando algo mudou) e pausa quando a aba fica em
  segundo plano. Uma pessoa com o painel aberto o dia todo gasta cerca de 40 mil
  comandos por mês. Confira o limite atual do plano gratuito no painel do Upstash;
  para reduzir o consumo, aumente `POLL_MS` em `public/app.js`.
