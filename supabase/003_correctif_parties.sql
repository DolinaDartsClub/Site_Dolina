-- =====================================================================
--  Correctif n°1 (15/10/2026) — à coller dans Supabase › SQL Editor, puis « Run »
--
--  Problème : la page d'accueil affichait « Impossible de charger les matchs ».
--  Cause : la table des joueurs d'une partie n'était pas reliée directement
--  à la table des parties, ce qui empêchait de lire les deux ensemble.
-- =====================================================================

alter table public.game_players
  add constraint game_players_game_id_fkey
  foreign key (game_id) references public.games (id) on delete cascade;

-- Demande à Supabase de relire la structure de la base
notify pgrst, 'reload schema';
