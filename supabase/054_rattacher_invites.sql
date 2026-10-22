-- =====================================================================
--  054 – Rattacher un invité à un compte (admin)
--  Un joueur qui a joué comme invité (tournois, parties) puis a créé son
--  compte : l'admin choisit les inscriptions et parties qui le concernent,
--  et elles passent sur son compte (stats, classement, records, profil).
--  Jamais automatique : l'admin coche ce qui correspond vraiment.
--  Un rattachement peut être annulé.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 053.
--  Peut être relancé sans risque.
-- =====================================================================

create table if not exists public.rattachements_invites (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  entry_id uuid references public.tournament_entries(id) on delete cascade,
  partenaire boolean not null default false,          -- inscription : rattaché comme joueur 2 d'une doublette
  game_player_id uuid references public.game_players(id) on delete cascade,
  ancien_nom text not null,
  fait_par uuid references public.profiles(id) on delete set null,
  fait_le timestamptz not null default now()
);
alter table public.rattachements_invites enable row level security;
drop policy if exists rattachements_admin on public.rattachements_invites;
create policy rattachements_admin on public.rattachements_invites for select to authenticated using (public.is_admin());

-- Invités dont le nom ressemble au membre (prénom, nom, surnom) ou à une recherche libre
create or replace function public.invites_correspondants(p_profile uuid, p_recherche text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  p public.profiles;
  mots text[];
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  select * into p from public.profiles where id = p_profile;
  if not found then raise exception 'Ce membre n''existe pas.'; end if;
  mots := array_remove(array[
    case when nullif(btrim(p_recherche), '') is not null then lower(btrim(p_recherche)) end,
    case when nullif(btrim(p_recherche), '') is null and length(p.first_name) >= 2 then lower(p.first_name) end,
    case when nullif(btrim(p_recherche), '') is null and length(p.last_name) >= 2 then lower(p.last_name) end,
    case when nullif(btrim(p_recherche), '') is null and length(coalesce(p.nickname, '')) >= 2 then lower(p.nickname) end
  ], null);
  return json_build_object(
    'inscriptions', coalesce((
      select json_agg(x order by x.quand desc) from (
        select e.id, t.name as tournoi, t.id as tournoi_id, coalesce(t.started_at, t.created_at) as quand,
               case when e.guest_name is not null then e.guest_name else e.partner_guest_name end as nom,
               e.guest_name is null as partenaire,
               (select count(*) from public.game_players gp join public.games g on g.id = gp.game_id
                  join public.tournament_matches m on m.id = g.tournament_match_id
                 where m.tournament_id = t.id and gp.profile_id is null
                   and gp.guest_name = coalesce(e.guest_name, e.partner_guest_name)) as parties,
               exists (select 1 from public.tournament_entries o where o.tournament_id = t.id
                        and (o.profile_id = p_profile or o.partner_profile_id = p_profile)) as deja_inscrit
        from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
        where (e.guest_name is not null and e.profile_id is null)
           or (e.partner_guest_name is not null and e.partner_profile_id is null)
      ) x where exists (select 1 from unnest(mots) w where lower(x.nom) like '%' || w || '%')), '[]'::json),
    'parties', coalesce((
      select json_agg(x order by x.quand desc) from (
        select gp.id, gp.guest_name as nom, g.id as game_id, g.variant, coalesce(g.finished_at, g.created_at) as quand,
               (select string_agg(o.display_name, ' / ') from public.game_players o where o.game_id = g.id and o.side <> gp.side) as adversaires,
               exists (select 1 from public.game_players o where o.game_id = g.id and o.profile_id = p_profile) as deja_dans_partie
        from public.game_players gp join public.games g on g.id = gp.game_id
        where gp.profile_id is null and gp.guest_name is not null and g.tournament_match_id is null
      ) x where exists (select 1 from unnest(mots) w where lower(x.nom) like '%' || w || '%')), '[]'::json),
    'rattaches', coalesce((
      select json_agg(json_build_object('id', r.id, 'ancien_nom', r.ancien_nom, 'fait_le', r.fait_le,
               'quoi', case when r.entry_id is not null then 'Tournoi : ' || (select t.name from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id where e.id = r.entry_id)
                            else 'Partie du ' || to_char((select coalesce(g.finished_at, g.created_at) from public.game_players gp join public.games g on g.id = gp.game_id where gp.id = r.game_player_id), 'DD/MM/YYYY') end)
             order by r.fait_le desc)
      from public.rattachements_invites r where r.profile_id = p_profile
        -- Les parties d'un tournoi rattaché suivent son inscription (annulées avec elle)
        and (r.entry_id is not null or not exists (select 1 from public.game_players gp join public.games g on g.id = gp.game_id
                                                   where gp.id = r.game_player_id and g.tournament_match_id is not null))), '[]'::json)
  );
end;
$$;

-- Rattache des inscriptions de tournoi (et leurs parties) et des parties libres au membre
create or replace function public.rattacher_invite(p_profile uuid, p_inscriptions uuid[] default '{}', p_parties uuid[] default '{}')
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  e public.tournament_entries;
  gp public.game_players;
  nom text;
  nb_insc int := 0;
  nb_parties int := 0;
  partenaire boolean;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  if not exists (select 1 from public.profiles where id = p_profile) then raise exception 'Ce membre n''existe pas.'; end if;
  perform set_config('dolina.interne', 'oui', true);

  foreach e in array (select coalesce(array_agg(x), '{}') from public.tournament_entries x where x.id = any(coalesce(p_inscriptions, '{}'))) loop
    partenaire := e.guest_name is null;
    nom := coalesce(e.guest_name, e.partner_guest_name);
    if nom is null then continue; end if;
    if exists (select 1 from public.tournament_entries o where o.tournament_id = e.tournament_id and o.id <> e.id
                and (o.profile_id = p_profile or o.partner_profile_id = p_profile))
       or (not partenaire and e.partner_profile_id = p_profile) or (partenaire and e.profile_id = p_profile) then
      raise exception 'Le membre est déjà inscrit dans le tournoi de « % » : rattachement impossible.', nom;
    end if;
    if partenaire then
      update public.tournament_entries set partner_profile_id = p_profile, partner_guest_name = null where id = e.id;
    else
      update public.tournament_entries set profile_id = p_profile, guest_name = null where id = e.id;
    end if;
    insert into public.rattachements_invites (profile_id, entry_id, partenaire, ancien_nom, fait_par) values (p_profile, e.id, partenaire, nom, auth.uid());
    nb_insc := nb_insc + 1;
    -- Ses parties dans ce tournoi
    for gp in select x.* from public.game_players x join public.games g on g.id = x.game_id
              join public.tournament_matches m on m.id = g.tournament_match_id
              where m.tournament_id = e.tournament_id and x.profile_id is null and x.guest_name = nom loop
      if exists (select 1 from public.game_players o where o.game_id = gp.game_id and o.profile_id = p_profile) then continue; end if;
      update public.game_players set profile_id = p_profile, guest_name = null where id = gp.id;
      insert into public.rattachements_invites (profile_id, game_player_id, ancien_nom, fait_par) values (p_profile, gp.id, nom, auth.uid());
      nb_parties := nb_parties + 1;
    end loop;
  end loop;

  foreach gp in array (select coalesce(array_agg(x), '{}') from public.game_players x where x.id = any(coalesce(p_parties, '{}'))) loop
    if gp.profile_id is not null or gp.guest_name is null then continue; end if;
    if exists (select 1 from public.game_players o where o.game_id = gp.game_id and o.profile_id = p_profile) then
      raise exception 'Le membre a déjà joué la partie de « % » sous son compte : rattachement impossible.', gp.guest_name;
    end if;
    nom := gp.guest_name;
    update public.game_players set profile_id = p_profile, guest_name = null where id = gp.id;
    insert into public.rattachements_invites (profile_id, game_player_id, ancien_nom, fait_par) values (p_profile, gp.id, nom, auth.uid());
    nb_parties := nb_parties + 1;
  end loop;
  return json_build_object('inscriptions', nb_insc, 'parties', nb_parties);
end;
$$;

-- Annule des rattachements : l'invité retrouve son nom
create or replace function public.annuler_rattachements(p_ids uuid[])
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  r public.rattachements_invites;
  n int := 0;
begin
  if not public.is_admin() then raise exception 'Réservé aux administrateurs.'; end if;
  perform set_config('dolina.interne', 'oui', true);
  for r in select * from public.rattachements_invites where id = any(coalesce(p_ids, '{}')) loop
    if r.entry_id is not null then
      if r.partenaire then
        update public.tournament_entries set partner_profile_id = null, partner_guest_name = r.ancien_nom where id = r.entry_id and partner_profile_id = r.profile_id;
      else
        update public.tournament_entries set profile_id = null, guest_name = r.ancien_nom where id = r.entry_id and profile_id = r.profile_id;
      end if;
      -- Les parties du tournoi rattachées en même temps
      update public.game_players gp set profile_id = null, guest_name = x.ancien_nom
      from public.rattachements_invites x
      where x.game_player_id = gp.id and x.profile_id = r.profile_id and gp.profile_id = r.profile_id
        and gp.game_id in (select g.id from public.games g join public.tournament_matches m on m.id = g.tournament_match_id
                           join public.tournament_entries te on te.tournament_id = m.tournament_id where te.id = r.entry_id);
      delete from public.rattachements_invites x using public.game_players gp
      where x.game_player_id = gp.id and x.profile_id = r.profile_id and gp.profile_id is null;
    elsif r.game_player_id is not null then
      update public.game_players set profile_id = null, guest_name = r.ancien_nom where id = r.game_player_id and profile_id = r.profile_id;
    end if;
    delete from public.rattachements_invites where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke execute on function public.invites_correspondants(uuid, text) from public, anon;
revoke execute on function public.rattacher_invite(uuid, uuid[], uuid[]) from public, anon;
revoke execute on function public.annuler_rattachements(uuid[]) from public, anon;
grant execute on function public.invites_correspondants(uuid, text) to authenticated;
grant execute on function public.rattacher_invite(uuid, uuid[], uuid[]) to authenticated;
grant execute on function public.annuler_rattachements(uuid[]) to authenticated;

notify pgrst, 'reload schema';
