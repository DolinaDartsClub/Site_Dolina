-- =====================================================================
--  039 – Jeux du club : Pentadarts et Capital
--  Historique des parties, complètement à part des matchs X01 : rien
--  n'entre dans les moyennes, les statistiques ni le classement.
--  - joueurs : [{ nom, profile_id (null pour un invité) }]
--  - resultat : classement, totaux et points de chaque jeu
--  - actions : la partie complète (pour la revoir ou la recalculer)
--  Lecture : membres validés. Ajout : membre validé (créateur = lui).
--  Suppression : le créateur ou un admin.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 038.
--  Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.jeux_parties (
  id          uuid primary key default gen_random_uuid(),
  jeu         text not null check (jeu in ('pentadarts', 'capital')),
  joueurs     jsonb not null check (jsonb_typeof(joueurs) = 'array' and jsonb_array_length(joueurs) between 1 and 8),
  ordre       jsonb,
  resultat    jsonb not null,
  actions     jsonb,
  created_by  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint jeux_parties_taille check (pg_column_size(actions) < 200000)
);
create index if not exists jeux_parties_jeu_date on public.jeux_parties (jeu, created_at desc);

alter table public.jeux_parties enable row level security;

drop policy if exists jeux_parties_select on public.jeux_parties;
create policy jeux_parties_select on public.jeux_parties for select to authenticated using (public.is_active_member());
drop policy if exists jeux_parties_insert on public.jeux_parties;
create policy jeux_parties_insert on public.jeux_parties for insert to authenticated
  with check (created_by = auth.uid() and public.is_active_member());
drop policy if exists jeux_parties_delete on public.jeux_parties;
create policy jeux_parties_delete on public.jeux_parties for delete to authenticated
  using (created_by = auth.uid() or public.is_admin());
