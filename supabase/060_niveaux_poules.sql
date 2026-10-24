-- =====================================================================
--  060 · Niveau des joueurs (têtes de série) pour équilibrer les poules
--  - L'admin donne un niveau à chaque membre (1 = meilleur … 5) : il sert
--    pour toutes les ligues et tous les tournois en poules.
--  - L'organisateur peut l'ajuster pour un tournoi (et noter les invités).
--  - Au lancement, les inscrits sont rangés par niveau puis répartis en
--    serpentin : chaque poule reçoit autant de joueurs forts que les autres.
--  Les niveaux restent privés : seuls les admins et l'organisateur les voient.
--  À exécuter après le script 059.
-- =====================================================================

create table if not exists public.niveaux_joueurs (
  profile_id  uuid primary key references public.profiles (id) on delete cascade,
  niveau      smallint not null check (niveau between 1 and 5),
  updated_at  timestamptz not null default now()
);
create table if not exists public.niveaux_inscrits (
  entry_id    uuid primary key references public.tournament_entries (id) on delete cascade,
  niveau      smallint not null check (niveau between 1 and 5)
);
alter table public.niveaux_joueurs enable row level security;
alter table public.niveaux_inscrits enable row level security;
drop policy if exists niveaux_joueurs_admin on public.niveaux_joueurs;
create policy niveaux_joueurs_admin on public.niveaux_joueurs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Niveau retenu pour un inscrit : celui du tournoi, sinon celui du membre
create or replace function public.niveau_inscrit(p_entry uuid)
returns smallint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select niveau from public.niveaux_inscrits where entry_id = p_entry),
    (select nj.niveau from public.tournament_entries e join public.niveaux_joueurs nj on nj.profile_id = e.profile_id where e.id = p_entry));
$$;
revoke execute on function public.niveau_inscrit(uuid) from public, anon, authenticated;

create or replace function public.definir_niveau_joueur(p_profile uuid, p_niveau int)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Seul un admin peut donner un niveau aux membres.';
  end if;
  if p_niveau is null then
    delete from public.niveaux_joueurs where profile_id = p_profile;
  elsif p_niveau not between 1 and 5 then
    raise exception 'Niveau entre 1 (meilleur) et 5.';
  else
    insert into public.niveaux_joueurs (profile_id, niveau) values (p_profile, p_niveau)
    on conflict (profile_id) do update set niveau = excluded.niveau, updated_at = now();
  end if;
end;
$$;

-- Niveaux des inscrits d'un tournoi (organisateur) : niveau du tournoi, ou celui du membre
create or replace function public.niveaux_tournoi(p_tournoi uuid)
returns table (entry_id uuid, niveau smallint, propre boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur voit les niveaux des joueurs.';
  end if;
  return query
    select e.id, public.niveau_inscrit(e.id), exists (select 1 from public.niveaux_inscrits ni where ni.entry_id = e.id)
    from public.tournament_entries e where e.tournament_id = p_tournoi;
end;
$$;

create or replace function public.definir_niveau_inscrit(p_entry uuid, p_niveau int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  e public.tournament_entries;
begin
  select * into e from public.tournament_entries where id = p_entry;
  if not found or not public.tournoi_organisateur(e.tournament_id) then
    raise exception 'Seul l''organisateur peut régler le niveau des joueurs.';
  end if;
  if p_niveau is null then
    delete from public.niveaux_inscrits where entry_id = p_entry;
  elsif p_niveau not between 1 and 5 then
    raise exception 'Niveau entre 1 (meilleur) et 5.';
  else
    insert into public.niveaux_inscrits (entry_id, niveau) values (p_entry, p_niveau)
    on conflict (entry_id) do update set niveau = excluded.niveau;
  end if;
end;
$$;

create or replace function public.creer_poules(p_tournoi uuid, p_inscrits uuid[], p_poules int)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int := coalesce(array_length(p_inscrits, 1), 0);
  i int; k int; r int; j int;
  joueurs uuid[];
  tmp uuid;
  journees int := 0;
  calendrier jsonb := '[]'::jsonb;    -- {poule, journee, a, b}
  no int := 1;
  ligne jsonb;
begin
  -- Répartition en serpentin (060) : A, B, C… puis …C, B, A. Les inscrits arrivent
  -- triés par niveau : chaque poule reçoit un joueur de chaque niveau, à tour de rôle
  for i in 1..n loop
    update public.tournament_entries set seed = i,
      pool_no = case when ((i - 1) / p_poules) % 2 = 0 then ((i - 1) % p_poules) + 1
                     else p_poules - ((i - 1) % p_poules) end
    where id = p_inscrits[i];
  end loop;

  for k in 1..p_poules loop
    select array_agg(id order by seed) into joueurs from public.tournament_entries
     where tournament_id = p_tournoi and pool_no = k;
    if coalesce(array_length(joueurs, 1), 0) % 2 = 1 then
      joueurs := joueurs || null::uuid;            -- place « repos »
    end if;
    for r in 1..array_length(joueurs, 1) - 1 loop
      for j in 1..array_length(joueurs, 1) / 2 loop
        if joueurs[j] is not null and joueurs[array_length(joueurs, 1) + 1 - j] is not null then
          calendrier := calendrier || jsonb_build_object('poule', k, 'journee', r,
            'a', joueurs[j], 'b', joueurs[array_length(joueurs, 1) + 1 - j]);
        end if;
      end loop;
      -- Rotation : le premier reste fixe, les autres tournent
      tmp := joueurs[array_length(joueurs, 1)];
      for j in reverse array_length(joueurs, 1)..3 loop
        joueurs[j] := joueurs[j - 1];
      end loop;
      joueurs[2] := tmp;
    end loop;
  end loop;

  -- Numérotation : journée par journée, poule par poule (ordre de jeu conseillé)
  for ligne in select value from jsonb_array_elements(calendrier)
               order by (value ->> 'journee')::int, (value ->> 'poule')::int loop
    insert into public.tournament_matches (tournament_id, match_no, phase, pool_no, round_no, entry_a, entry_b, status)
    values (p_tournoi, no, 'pool', (ligne ->> 'poule')::int, (ligne ->> 'journee')::int,
            (ligne ->> 'a')::uuid, (ligne ->> 'b')::uuid, 'ready');
    no := no + 1;
  end loop;
  return no - 1;
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

  -- Tirage au sort ; en poules, les inscrits sont d'abord rangés par niveau (060) :
  -- niveau 1 (meilleurs) en premier, sans niveau à la fin, tirage au sort à niveau égal
  if t.format = 'pools' then
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

grant execute on function public.definir_niveau_joueur(uuid, int) to authenticated;
grant execute on function public.niveaux_tournoi(uuid) to authenticated;
grant execute on function public.definir_niveau_inscrit(uuid, int) to authenticated;
revoke execute on function public.creer_poules(uuid, uuid[], int) from public, anon, authenticated;
