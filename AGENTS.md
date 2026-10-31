# AGENTS.md: instruções para agentes de IA

Este arquivo vale para qualquer assistente que trabalhe neste repositório (Claude, Codex, Copilot etc.).
Leia também o **`memory.md`** (resumo do projeto, decisões e histórico) e o **`README.md`** (instalação).

## Projeto
Minha Estante: app pessoal de jogos (PS4, PS5, Steam) e livros. Site estático sem build na Vercel
(`index.html` com o app inteiro + funções em `api/*.js`) e dados no Supabase.

## Regras de trabalho
1. **Idioma**: fale com o dono (Hygor) sempre em **português**, simples e passo a passo. Ele não é programador:
   diga onde clicar (ex.: Vercel → Settings → Environment Variables).
2. **Segredos**: nunca peça, aceite, mostre ou grave no código chaves, senhas, `service_role` ou o token `PSN_NPSSO`.
   Eles ficam só nas variáveis da Vercel, que o dono cadastra sozinho e depois faz **Redeploy**.
3. **Branches**: faça as mudanças numa branch separada. Só faça merge/push na `main` quando o dono disser
   "pode subir para main". Push na `main` publica o site.
4. **Banco**: mudança de tabela vai para o `supabase.sql` de forma idempotente (`if not exists`, `drop policy if exists`),
   e o dono roda no SQL Editor do Supabase. O app deve continuar funcionando antes de ele rodar.
5. **Atualize o `memory.md`** quando tomar uma decisão importante ou terminar uma tarefa relevante (seção Histórico),
   e o `README.md` quando mudar algo da instalação ou das variáveis.

## Regras de código
- Use `esc()` em todo texto que vai para o HTML e `urlOk()` em todo `href` com dado externo (só aceita http/https).
- Erros das rotas `api/` usam `ErroHttp(status, mensagem, codigo?)` com mensagens em português para o usuário.
- O `vercel.json` tem CSP: se o navegador passar a acessar um site novo, acrescente-o em `connect-src`.
- supabase-js tem versão fixa com SRI (`SUPABASE_CDN` / `SUPABASE_SRI`); ao trocar a versão, troque o hash.
- Sincronização Steam/PSN nunca sobrescreve prioridade, notas, meta e dificuldade, e nunca diminui horas.
- Não versione `package-lock.json` nem `node_modules`.

## Antes de commitar
- `node --check api/*.js`
- Abra o `index.html` num navegador (Playwright já instalado) simulando as rotas `/api/*` e confira se não há
  erros no console nem bloqueios de CSP. Sem `api/config`, o app roda em modo só-local.
