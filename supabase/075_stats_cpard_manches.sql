-- =====================================================================
--  075 – Bilan CPARD des joueurs : manches gagnées / perdues séparées
--  en simples et en doubles (en plus du total).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 074.
--  Peut être relancé sans risque.
-- =====================================================================

create or replace function public.stats_cpard_equipe(p_team uuid, p_debut date default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  res json;
begin
  if not public.feuille_peut_gerer(p_team) then
    raise exception 'Réservé au capitaine de l''équipe.';
  end if;
  with lignes as (
    -- une ligne par joueur de notre équipe et par match terminé
    select f.id as feuille, r.date_match,
           j.joueur ->> 'p' as profil, nullif(trim(j.joueur ->> 'n'), '') as nom,
           jsonb_array_length(js -> lower(f.notre_camp)) = 2 as double,
           case when f.notre_camp = 'A' then m.manches_a else m.manches_e end as pour,
           case when f.notre_camp = 'A' then m.manches_e else m.manches_a end as contre
    from public.feuilles_match f
    join public.rencontres r on r.id = f.rencontre_id
    join public.feuille_matchs m on m.feuille_id = f.id and m.statut = 'termine'
    cross join lateral (select coalesce(m.joueurs, public.feuille_joueurs_match(f, m.numero)) as js) x
    cross join lateral jsonb_array_elements(x.js -> lower(f.notre_camp)) as j(joueur)
    where f.team_id = p_team and f.statut = 'validee'
      and (p_debut is null or r.date_match >= p_debut)
      and jsonb_typeof(j.joueur) = 'object'
  ), par_joueur as (
    select coalesce(l.profil, 'nom:' || lower(l.nom)) as cle,
           max(l.profil) as profile_id,
           coalesce(max(public.nom_affiche(p)), max(l.nom)) as nom,
           count(distinct l.feuille)::int as rencontres,
           count(*) filter (where not l.double and l.pour > l.contre)::int as simples_g,
           count(*) filter (where not l.double and l.pour < l.contre)::int as simples_p,
           count(*) filter (where l.double and l.pour > l.contre)::int as doubles_g,
           count(*) filter (where l.double and l.pour < l.contre)::int as doubles_p,
           coalesce(sum(l.pour), 0)::int as manches_g,
           coalesce(sum(l.contre), 0)::int as manches_p,
           coalesce(sum(l.pour) filter (where not l.double), 0)::int as manches_simples_g,
           coalesce(sum(l.contre) filter (where not l.double), 0)::int as manches_simples_p,
           coalesce(sum(l.pour) filter (where l.double), 0)::int as manches_doubles_g,
           coalesce(sum(l.contre) filter (where l.double), 0)::int as manches_doubles_p
    from lignes l
    left join public.profiles p on p.id::text = l.profil
    where l.profil is not null or l.nom is not null
    group by 1
  )
  select json_build_object(
    'feuilles', (select count(*) from public.feuilles_match f join public.rencontres r on r.id = f.rencontre_id
                 where f.team_id = p_team and f.statut = 'validee' and (p_debut is null or r.date_match >= p_debut)),
    'joueurs', coalesce((select json_agg(row_to_json(j) order by (j.simples_g + j.doubles_g) desc, (j.manches_g - j.manches_p) desc, j.nom) from par_joueur j), '[]'::json))
  into res;
  return res;
end;
$$;

grant execute on function public.stats_cpard_equipe(uuid, date) to authenticated;
notify pgrst, 'reload schema';
