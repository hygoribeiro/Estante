# Minha Estante

App pessoal para organizar jogos (PS4, PS5, Steam) e livros. Funciona no celular e no PC.

- **Na Vercel:** login, dados salvos no Supabase (iguais em todos os aparelhos) e sincronização com Steam e PSN.
- **Aberto como arquivo ou no GitHub Pages:** funciona só no aparelho (localStorage), como antes.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | O app inteiro (tela, lógica, login, sincronização) |
| `api/config.js` | Entrega ao app as configurações públicas do Supabase |
| `api/steam.js` | Busca biblioteca, horas e conquistas na Steam (API oficial) |
| `api/psn.js` | Busca troféus e horas na PSN (biblioteca não oficial `psn-api`) |
| `api/_comum.js` | Confere o login antes de liberar Steam/PSN |
| `supabase.sql` | Cria a tabela e as regras de segurança no Supabase |
| `vercel.json`, `package.json` | Configuração da Vercel |
| `api/lembrete.js` | Tarefas diárias do cron da Vercel (21h): backup semanal, lembrete e alerta de preço |
| `api/precos.js`, `api/_precos.js` | Busca jogos e preços (em reais) na loja da Steam para a lista de desejos |
| `api/trofeus.js` | Lista completa de troféus/conquistas de um jogo (PSN ou Steam): todos, quais já foram pegos, data, raridade e descrição |
| `api/_psn.js`, `api/_steam.js` | Login na PSN e credenciais da Steam, usados por mais de uma rota |
| `api/promocoes.js` | Aba Promoções: promoções da Steam, preços da GG.deals para a lista de desejos e ofertas de lojas de PC do IsThereAnyDeal |
| `sw.js`, `manifest.webmanifest`, `icones/` | App instalável (tela inicial), abre offline e recebe notificações |

## Instalação (uma vez)

### 1. Supabase
1. Crie um projeto novo em supabase.com (ex.: `estante`).
2. **SQL Editor → New query**: cole o conteúdo de `supabase.sql` e clique em **Run**.
3. **Authentication → Users → Add user → Create new user**: seu e-mail e uma senha. Marque **Auto Confirm User**.
4. **Authentication → Sign In / Providers**: desligue **Allow new users to sign up** (ninguém mais consegue criar conta).
5. **Project Settings → API**: copie a **Project URL** e a chave **anon public**.

### 2. Chaves da Steam
1. Acesse steamcommunity.com/dev/apikey, informe um domínio qualquer (ex.: `estante.vercel.app`) e gere a chave.
2. Seu SteamID: o número de 17 dígitos na URL do seu perfil (`steamcommunity.com/profiles/7656...`) ou o nome personalizado (`steamcommunity.com/id/SEUNOME`).
3. Na Steam: **Perfil → Editar perfil → Privacidade**: deixe **Meu perfil** e **Detalhes de jogos** como **Público**.

### 3. Token da PSN (NPSSO)
1. Entre em playstation.com com sua conta, no mesmo navegador.
2. Abra `https://ca.account.sony.com/api/v1/ssocookie`.
3. Copie o valor de `npsso` (64 caracteres). **Trate como senha.** Ele expira em cerca de 2 meses.

### 4. Vercel
1. **Add New → Project → Import** o repositório `Estante`. Framework: **Other**. Clique em **Deploy**.
2. **Settings → Environment Variables**, adicione:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | chave anon public do Supabase |
| `EMAIL_PERMITIDO` | seu e-mail (só ele pode usar Steam/PSN) |
| `STEAM_API_KEY` | chave da Steam |
| `STEAM_ID` | seu SteamID |
| `PSN_NPSSO` | token NPSSO |

3. **Deployments → ⋯ → Redeploy** para as variáveis valerem.

### 5. Primeiro uso
1. Abra o link da Vercel e entre com o e-mail e a senha do passo 1.3.
2. Se você já tem dados no app antigo: lá, **Ajustes → Exportar backup**; no novo, **Ajustes → Importar backup**.
3. **Jogos → 🔄 Steam / PSN**: revise o que vai mudar e toque em **Aplicar**.

## Lembrete diário (opcional)
Por volta das 21h (horário de Brasília), se você não registrou nada no dia, chega uma notificação de que a sequência está em risco.

1. **Supabase → SQL Editor**: rode de novo o `supabase.sql` inteiro (ele cria a tabela `lembretes` e não mexe nos seus dados).
2. **Vercel → Settings → Environment Variables**: adicione `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `CRON_SECRET` e `SUPABASE_SERVICE_ROLE_KEY` (esta última em Supabase → Project Settings → API → `service_role`; é secreta, nunca coloque no app). Para gerar as chaves VAPID: `npx web-push generate-vapid-keys`. `CRON_SECRET` é qualquer texto longo e aleatório.
3. **Deployments → ⋯ → Redeploy**.
4. No app: **Ajustes → Lembrete diário → Ativar neste aparelho** e depois **Enviar notificação de teste**.

No Android, funciona no Chrome (melhor ainda com o app instalado: menu ⋮ → Instalar app). No iPhone (iOS 16.4+), primeiro adicione o app à Tela de Início e ative por lá. O plano gratuito da Vercel roda o cron uma vez por dia, em algum momento dentro da hora marcada.

## Lista de desejos e cópias automáticas
- **Jogos → Desejos**: jogos que você ainda não tem. Busque pelo nome na Steam para o preço (em reais) vir sozinho; para PlayStation, anote o preço e o link da loja.
- Com o lembrete diário ativado, chega um aviso no celular quando um jogo da Steam chega no seu **preço alvo** (ou com 50%+ de desconto, se não houver alvo). O mesmo preço não é avisado duas vezes.
- **Ajustes → Cópias automáticas na nuvem**: toda semana o servidor guarda uma cópia completa da estante (ficam as 8 mais recentes). Dá para fazer uma na hora e restaurar qualquer uma (antes de restaurar, o app guarda uma cópia do estado atual).
- Para funcionar, rode no Supabase o trecho **"Backups automáticos e alertas de preço"** do `supabase.sql` (uma vez). Não precisa de variável nova na Vercel.

## Renovar o token da PSN (a cada ~2 meses)
Quando a sincronização da PSN avisar que o NPSSO expirou: gere um novo (passo 3), troque `PSN_NPSSO` na Vercel e faça **Redeploy**.
O próprio app mostra esse passo a passo, com os links, no botão **Como renovar** (no aviso de erro e em **Ajustes → Token da PSN**).

Aviso antes de vencer: o `api/config` entrega uma "impressão digital" do token (12 letras do SHA-256, não o token).
O app guarda o dia em que viu cada token pela primeira vez e, a partir de 50 dias, mostra um aviso na aba Jogos.
Com o lembrete diário ativado, o cron também manda uma notificação (uma vez por token) quando ele está perto de vencer
ou quando a PSN já recusou o token.

## Como a sincronização funciona
- Cada alteração vai para a nuvem em ~1 segundo. O indicador no topo mostra **Salvo**, **Salvando…** ou **Offline**.
- Sem internet, tudo continua funcionando e é enviado quando a conexão voltar.
- Se dois aparelhos alterarem ao mesmo tempo, o app pergunta qual versão manter.
- Steam/PSN atualizam horas, % e marcam Platinado/100% (com a data real). Prioridade, notas, meta e dificuldade nunca são sobrescritas.

## Avisos
- A integração com a PSN usa uma biblioteca **não oficial**. Pode parar de funcionar se a Sony mudar algo, e é uma zona cinzenta nos termos de uso da Sony.
- Nunca coloque chaves ou o NPSSO no código. Elas ficam só nas variáveis da Vercel.
- Segurança do site: o `vercel.json` manda uma política de conteúdo (CSP) que só deixa o app falar com o próprio site,
  o Supabase (`*.supabase.co`), o Google Books e a Open Library. Se um dia trocar o Supabase por um endereço próprio,
  acrescente esse endereço em `connect-src`. O supabase-js tem versão fixa e é conferido (SRI) antes de rodar.

## Aba Promoções (GG.deals)
- **Promoções em destaque na Steam**: em reais, automáticas, sem chave. Botão "+ Desejos" leva o jogo para a lista de desejos.
- **Sua lista de desejos na GG.deals**: melhor preço em lojas oficiais e keyshops, e o menor preço da história, para os jogos da Steam da lista de desejos.
  Precisa da chave gratuita da API oficial: crie conta em gg.deals, gere a chave da API e adicione na Vercel como `GGDEALS_API_KEY` (depois **Redeploy**).
  Uso pessoal; a GG.deals pede crédito com link onde os preços aparecem (o app já mostra).
- **Ofertas de todas as lojas de PC** (IsThereAnyDeal, API oficial): Novas ofertas, Maiores descontos e Mínimas históricas, em reais.
  Precisa da chave gratuita: crie conta em isthereanydeal.com, confirme o e-mail, registre um app em isthereanydeal.com/apps/my/ e adicione na Vercel como `ITAD_API_KEY` (depois **Redeploy**). Termos: uso pessoal, com link para o IsThereAnyDeal; os links das lojas não são alterados.
- **Pesquisar promoção** (topo da aba): digite o nome do jogo e veja o preço em todas as lojas de PC agora, o menor da história e o do último ano (IsThereAnyDeal).
- O botão **Abrir GG.deals** leva ao site, que também mostra ofertas de PlayStation e Xbox.
