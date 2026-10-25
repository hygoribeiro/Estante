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
