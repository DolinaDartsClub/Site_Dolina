-- =====================================================================
--  058 · Équipe de test : masquée de la page d'accueil
--  Une équipe avec « accueil = false » garde sa page Équipes, son
--  calendrier et ses feuilles de match, mais ses rencontres, résultats et
--  annonces n'apparaissent pas sur la page d'accueil.
--  À exécuter après le script 057.
-- =====================================================================

alter table public.teams add column if not exists accueil boolean not null default true;

-- A.R.M.Y. 78 : équipe de test
update public.teams set accueil = false
 where regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'army78%';
