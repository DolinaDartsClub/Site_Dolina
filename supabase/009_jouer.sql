-- =====================================================================
--  Étape 5 — Jouer (à coller dans Supabase › SQL Editor, puis « Run »)
--
--  - Mémorise le camp qui a gagné le tirage au bull (il commence la partie)
--  - Accélère la recherche des parties en cours d'un joueur
-- =====================================================================

alter table public.games
  add column if not exists first_side smallint not null default 1 check (first_side between 1 and 4);

create index if not exists games_created_by_status on public.games (created_by, status, created_at desc);

-- Fin du script.
