-- =====================================================================
--  063 · Niveaux : réglés par l'admin seulement, utilisés pour la ligue seulement
--  - Le niveau se donne uniquement dans Admin › Membres.
--  - Plus de niveau par tournoi : l'organisateur d'un tournoi n'a rien à régler.
--  - Seule la ligue interne équilibre ses poules selon les niveaux ; les
--    autres tournois en poules restent tirés au sort.
--  À exécuter après le script 062.
-- =====================================================================

-- Niveau d'un inscrit : celui donné par l'admin au membre (les invités n'en ont pas)
create or replace function public.niveau_inscrit(p_entry uuid)
returns smallint language sql stable security definer set search_path = public as $$
  select nj.niveau from public.tournament_entries e
  join public.niveaux_joueurs nj on nj.profile_id = e.profile_id
  where e.id = p_entry;
$$;
revoke execute on function public.niveau_inscrit(uuid) from public, anon, authenticated;

-- Niveaux des inscrits de la ligue : admin seulement, lecture seule
create or replace function public.niveaux_tournoi(p_tournoi uuid)
returns table (entry_id uuid, niveau smallint, propre boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Seul un admin voit les niveaux des joueurs.';
  end if;
  return query
    select e.id, public.niveau_inscrit(e.id), false
    from public.tournament_entries e
    join public.tournaments t on t.id = e.tournament_id and t.est_ligue
    where e.tournament_id = p_tournoi;
end;
$$;

create or replace function public.lancer_tournoi(p_tournoi uuid, p_format jsonb, p_poules int default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  f jsonb := public.verifier_format_match(p_format);
  n int;
  tirage uuid[];
  plus_petite int;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found or not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut le lancer.';
  end if;
  if t.status not in ('draft', 'open') then
    raise exception 'Ce tournoi est déjà lancé.';
  end if;

  -- Tirage au sort ; dans la ligue interne (063), les inscrits sont d'abord rangés par niveau :
  -- niveau 1 (meilleurs) en premier, sans niveau à la fin, tirage au sort à niveau égal
  if t.format = 'pools' and t.est_ligue then
    select array_agg(e.id order by public.niveau_inscrit(e.id) nulls last, random()) into tirage
    from public.tournament_entries e where e.tournament_id = p_tournoi;
  else
    select array_agg(id order by random()) into tirage from public.tournament_entries where tournament_id = p_tournoi;
  end if;
  n := coalesce(array_length(tirage, 1), 0);

  perform set_config('dolina.interne', 'oui', true);
  update public.tournament_entries set pool_no = null, seed = null where tournament_id = p_tournoi;
  delete from public.tournament_matches where tournament_id = p_tournoi;

  if t.format = 'knockout' then
    if n < 2 then
      raise exception 'Il faut au moins 2 participants pour lancer le tournoi.';
    end if;
    for i in 1..n loop
      update public.tournament_entries set seed = i where id = tirage[i];
    end loop;
    perform public.creer_arbre(p_tournoi, tirage, 1, t.third_place);
    update public.tournaments set status = 'running', started_at = now(), final_format = f, pools_count = null where id = p_tournoi;
  else
    if n < 3 then
      raise exception 'Il faut au moins 3 participants pour un tournoi avec poules.';
    end if;
    p_poules := coalesce(p_poules, t.pools_count, greatest(1, ceil(n / 4.0)::int));
    if p_poules < 1 or p_poules > 16 or n / p_poules < 2 then
      raise exception 'Avec % participants, choisissez entre 1 et % poules (2 joueurs minimum par poule).', n, least(16, n / 2);
    end if;
    plus_petite := n / p_poules;
    if t.pool_qualifiers > plus_petite then
      raise exception '% qualifiés par poule : impossible avec des poules de % joueurs. Réduisez le nombre de qualifiés ou de poules.', t.pool_qualifiers, plus_petite;
    end if;
    if t.pool_qualifiers * p_poules < 2 then
      raise exception 'Il faut au moins 2 qualifiés au total pour la phase finale.';
    end if;
    perform public.creer_poules(p_tournoi, tirage, p_poules);
    update public.tournaments set status = 'running', started_at = now(), pool_format = f, pools_count = p_poules where id = p_tournoi;
  end if;
end;
$$;

drop function if exists public.definir_niveau_inscrit(uuid, int);
drop table if exists public.niveaux_inscrits;
