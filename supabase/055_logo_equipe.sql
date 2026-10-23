-- =====================================================================
--  055 · Logo propre à chaque équipe du site
--  Une équipe qui n'est pas « Dolina » (ex. A.R.M.Y. 78) affiche son
--  logo sur sa page Équipes, ses rencontres et ses annonces.
--  Sans logo, l'équipe garde celui du Dolina Darts Club.
-- =====================================================================

alter table public.teams add column if not exists logo text;

-- Annonce liée à une équipe : son logo sert d'image si l'article n'a pas de photo
alter table public.articles add column if not exists team_id uuid references public.teams (id) on delete set null;

-- Logo déjà présent sur le site pour l'équipe A.R.M.Y. 78
update public.teams set logo = 'assets/img/adversaires/army-78.webp'
 where logo is null and regexp_replace(lower(name), '[^a-z0-9]', '', 'g') like 'army78%';
