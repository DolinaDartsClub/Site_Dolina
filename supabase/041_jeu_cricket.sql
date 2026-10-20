-- =====================================================================
--  041 – Jeux du club : le cricket seul (mêmes règles que dans le Pentadarts)
--  Autorise le jeu « cricket » dans l'historique des parties.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 040.
-- =====================================================================

alter table public.jeux_parties drop constraint if exists jeux_parties_jeu_check;
alter table public.jeux_parties add constraint jeux_parties_jeu_check check (jeu in ('pentadarts', 'capital', 'cricket'));
