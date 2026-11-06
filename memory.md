# Memória do projeto: Minha Estante

Anotações para quem for trabalhar neste sistema (pessoas ou Claude). O manual de instalação está no `README.md`.

## O que é
App pessoal do Hygor para organizar **jogos** (PS4, PS5, Steam) e **livros**: missões/XP, sequência diária,
troféus, lista de desejos com preços e aba de promoções. Funciona no celular e no PC (PWA instalável).
- Repositório: `hygoribeiro/Estante` (público). Push na `main` publica na Vercel.
- Dados: Supabase (tabela `estante`, um JSON por usuário com `versao` para bloqueio otimista) + cópia no localStorage.
- Sem build: `index.html` tem o app inteiro; `api/*.js` são as funções da Vercel (arquivos com `_` não viram rota).

## Como trabalhar com o dono (Hygor)
- Fale sempre em **português**, simples e passo a passo (ele não é programador; diga onde clicar).
- **Nunca** peça nem aceite chaves, senhas ou o token NPSSO. Ele mesmo cadastra tudo em
  Vercel → Settings → Environment Variables e depois faz **Redeploy**.
- Mudanças vão primeiro para uma branch separada; só suba para a `main` quando ele disser "pode subir para main".
- Ele também tem o sistema do Verdurão (`hygoribeiro/Sistema-Financeiro-Ceasa`), que é outro projeto.

## Variáveis na Vercel
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `EMAIL_PERMITIDO`, `STEAM_API_KEY`, `STEAM_ID`, `PSN_NPSSO`,
`GGDEALS_API_KEY`, `ITAD_API_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`.

## Token da PSN (NPSSO): vence a cada ~2 meses
- Sintoma: "O token da PSN (NPSSO) venceu ou é inválido" ao sincronizar. Não é bug: precisa gerar outro.
- Renovar: entrar em playstation.com → abrir `https://ca.account.sony.com/api/v1/ssocookie` → copiar o valor de
  `npsso` → trocar `PSN_NPSSO` na Vercel → Redeploy. O app mostra esse passo a passo no botão **Como renovar**.
- Como o aviso funciona: `api/config` devolve `psnToken` (12 letras do SHA-256 do token, não o token).
  O app guarda em `state.integracoes.psnToken = { id, desde, vencido }`; a partir de 50 dias mostra aviso na aba Jogos.
  O cron (`api/lembrete.js`) testa o login e manda notificação uma vez por token (marca em `alertas_preco`
  com appid `psn-perto:<id>` / `psn-venceu:<id>`).
- Erro de rede/Sony fora do ar vira 502 e **não** marca o token como vencido (só erro de autenticação usa `codigo: 'npsso'`).

## Decisões e regras importantes
- Sincronização Steam/PSN **nunca diminui** as horas jogadas (a PSN atualiza com atraso).
- `aplicarPlano` procura os jogos pelo id na hora de aplicar (o estado pode ter sido trocado pela nuvem).
- Data de conclusão na PSN = dia da platina (busca o troféu platina; na falta, data do último troféu).
- Backups no cron: automáticos (semanais) e do app (manuais/segurança) contam separado, 8 de cada.
- Links só abrem `http(s)` (`urlOk`/`ehUrlWeb` em `index.html`); use `urlOk(...)` em todo `href` com dado externo.
- supabase-js com versão fixa e SRI (`SUPABASE_CDN`/`SUPABASE_SRI`). Ao trocar a versão, troque o hash junto.
- CSP no `vercel.json`: se o app passar a buscar um site novo pelo navegador, acrescente em `connect-src`.
- CSV: texto começando com `= + - @` recebe `'` na frente (evita fórmula no Excel).
- `sw.js` é network-first para a página; ícones e manifesto ficam em cache (`CACHE = 'estante-v1'`).

## Testar
Não há testes automáticos no repositório. Para conferir uma mudança: `node --check api/*.js` e abrir o
`index.html` num navegador (Playwright) simulando `/api/*`; sem `api/config` o app roda em modo só-local.

## Histórico

### Conversa de 31/10 a 06/11/2026 (salva antes de formatar o PC)
Sessão do Claude Code na nuvem: https://claude.ai/code/session_01RmSo6yWVYspZZVcPDLCru2
(a conversa fica guardada na conta do claude.ai, não no PC; formatar o PC não apaga nada).

**Como começou:** ao sincronizar a PSN apareceu "O token NPSSO da PSN expirou ou é inválido".
Causa: o token NPSSO vence sozinho a cada ~2 meses. Não era defeito no código.

**O que foi feito (tudo já está na `main` e publicado na Vercel):**
1. Commit `be8df64`: o erro de token vencido mostra o passo a passo com botões (playstation.com, página do
   código, Vercel) na sincronização e na tela de troféus. Ajustes → "Token da PSN" mostra há quantos dias está
   em uso e quando deve vencer; aviso na aba Jogos a partir de 50 dias; notificação no celular pelo cron.
2. Commit `fe73d8a`: queda da PSN/Sony não é mais tratada como token vencido; sincronização bem-sucedida
   tira a marca de vencido; o token também é registrado depois de entrar com e-mail e senha.
3. Commit `507b6f0` ("banca": revisão completa do sistema, 10 correções):
   supabase-js fixo com SRI + CSP no `vercel.json`; links só http(s); aplicar sincronização procura jogos pelo id;
   horas nunca diminuem; data real da platina; horas da PSN casadas com nomes parecidos; backups automáticos e
   do app contam separado (8 de cada); GG.deals 429 não aparece como chave inválida; Steam fora do ar não aparece
   como STEAM_ID errado; CSV protegido contra fórmula.
4. Commits `ce9fdd0` e `5d685fe`: criados este `memory.md` e o `AGENTS.md`.

**Pendências (onde paramos):**
- [ ] Hygor precisa **renovar o token da PSN** (passos em "Token da PSN" acima). Sem isso os jogos da PSN não aparecem.
- [ ] Depois de renovar: abrir o app, sincronizar a PSN e conferir se Ajustes → Token da PSN mostra "Trocado hoje".
- [ ] Testar no site de verdade o que não deu para testar na nuvem: login (supabase-js novo + CSP),
      sincronização PSN/Steam (data da platina e horas) e a aba Promoções. Se algo quebrar, mandar print.
- Ideias não feitas (só se ele pedir): tabela própria para os avisos do token (hoje usa `alertas_preco`);
  limitar a busca da data da platina aos jogos ainda não concluídos no app.

**Para retomar:** abrir uma conversa nova no Claude Code com o repositório `hygoribeiro/Estante` e dizer
"leia o memory.md e o AGENTS.md e continue de onde paramos".
