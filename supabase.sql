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
