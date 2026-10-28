-- Minha Estante — rode este script UMA vez no Supabase (SQL Editor → New query → Run)

create table if not exists public.estante (
  user_id uuid primary key references auth.users(id) on delete cascade,
  dados jsonb not null,
  versao integer not null default 1,
  atualizado_em timestamptz not null default now()
);

-- Segurança: cada usuário só enxerga e altera a própria linha
alter table public.estante enable row level security;

drop policy if exists "estante_ler" on public.estante;
drop policy if exists "estante_inserir" on public.estante;
drop policy if exists "estante_atualizar" on public.estante;

create policy "estante_ler" on public.estante
  for select using (auth.uid() = user_id);
create policy "estante_inserir" on public.estante
  for insert with check (auth.uid() = user_id);
create policy "estante_atualizar" on public.estante
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Lembrete diário (rode também este trecho, mesmo que o de cima já tenha sido rodado)
-- Uma linha por aparelho que ativou o lembrete (assinatura de notificação do navegador)
create table if not exists public.lembretes (
  endpoint text primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  assinatura jsonb not null,
  criado_em timestamptz not null default now()
);

alter table public.lembretes enable row level security;

drop policy if exists "lembretes_ler" on public.lembretes;
drop policy if exists "lembretes_inserir" on public.lembretes;
drop policy if exists "lembretes_atualizar" on public.lembretes;
drop policy if exists "lembretes_apagar" on public.lembretes;

create policy "lembretes_ler" on public.lembretes
  for select using (auth.uid() = user_id);
create policy "lembretes_inserir" on public.lembretes
  for insert with check (auth.uid() = user_id);
create policy "lembretes_atualizar" on public.lembretes
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "lembretes_apagar" on public.lembretes
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------
-- Backups automáticos e alertas de preço (rode este trecho uma vez; não mexe nos seus dados)
-- backups: cópias da estante. O servidor faz uma por semana e guarda as 8 mais recentes;
-- o app também pode fazer uma na hora e restaurar qualquer uma.
create table if not exists public.backups (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  origem text not null default 'manual',
  jogos integer,
  livros integer,
  dados jsonb not null
);
create index if not exists backups_usuario_data on public.backups (user_id, criado_em desc);

alter table public.backups enable row level security;

drop policy if exists "backups_ler" on public.backups;
drop policy if exists "backups_inserir" on public.backups;
drop policy if exists "backups_apagar" on public.backups;

create policy "backups_ler" on public.backups
  for select using (auth.uid() = user_id);
create policy "backups_inserir" on public.backups
  for insert with check (auth.uid() = user_id);
create policy "backups_apagar" on public.backups
  for delete using (auth.uid() = user_id);

-- alertas_preco: último preço avisado de cada jogo da lista de desejos (evita repetir o aviso).
-- Só o servidor usa esta tabela; sem políticas, o app não tem acesso a ela.
create table if not exists public.alertas_preco (
  user_id uuid not null references auth.users(id) on delete cascade,
  appid text not null,
  preco numeric not null,
  avisado_em timestamptz not null default now(),
  primary key (user_id, appid)
);

alter table public.alertas_preco enable row level security;
