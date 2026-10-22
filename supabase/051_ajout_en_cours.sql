-- =====================================================================
--  051 – Ajouter un joueur pendant un tournoi en poules (ou la ligue)
--  L'organisateur (ou un admin) peut ajouter un membre, un invité ou une
--  doublette à un tournoi déjà lancé, tant que la phase finale n'a pas
--  commencé. Le joueur rejoint une poule (au choix, ou la moins remplie)
--  et ses matchs contre chaque joueur de la poule sont créés.
--  Impossible en élimination directe : l'arbre est déjà tiré.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 050.
--  Peut être relancé sans risque.
-- =====================================================================

-- Inscription : autorisée pendant le tournoi seulement par la fonction ci-dessous
create or replace function public.inscription_avant_ajout()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  nb int;
  doublon uuid;
begin
  -- Verrou sur le tournoi : deux inscriptions simultanées ne peuvent pas dépasser le nombre de places
  select * into t from public.tournaments where id = new.tournament_id for update;
  if not found then
    raise exception 'Ce tournoi n''existe pas.';
  end if;
  if t.status = 'running' and coalesce(current_setting('dolina.ajout_en_cours', true), '') <> 'oui' then
    raise exception 'Les inscriptions sont terminées : le tournoi a déjà commencé.';
  elsif t.status = 'finished' then
    raise exception 'Ce tournoi est terminé.';
  end if;

  select count(*) into nb from public.tournament_entries where tournament_id = t.id;
  if nb >= t.max_participants then
    raise exception 'Le tournoi est complet (% places).', t.max_participants;
  end if;

  -- Nettoyage des noms saisis
  new.guest_name := nullif(btrim(new.guest_name), '');
  new.partner_guest_name := nullif(btrim(new.partner_guest_name), '');
  new.team_name := nullif(btrim(new.team_name), '');
  if new.profile_id is not null then new.guest_name := null; end if;
  if new.partner_profile_id is not null then new.partner_guest_name := null; end if;

  if new.profile_id is null and new.guest_name is null then
    raise exception 'Indiquez un membre ou le nom d''un invité.';
  end if;

  if t.team_mode = 'double' then
    if new.team_name is null then
      raise exception 'Donnez un nom à la doublette.';
    end if;
    if new.partner_profile_id is null and new.partner_guest_name is null then
      raise exception 'Indiquez le partenaire de la doublette (membre ou invité).';
    end if;
    if new.partner_profile_id is not null and new.partner_profile_id = new.profile_id then
      raise exception 'Le partenaire doit être une autre personne.';
    end if;
    if exists (select 1 from public.tournament_entries e where e.tournament_id = t.id and lower(e.team_name) = lower(new.team_name)) then
      raise exception 'Une doublette s''appelle déjà « % » dans ce tournoi.', new.team_name;
    end if;
  else
    new.team_name := null;
    new.partner_profile_id := null;
    new.partner_guest_name := null;
  end if;

  -- Un membre ne figure qu'une fois dans le tournoi, comme joueur ou comme partenaire
  select x into doublon from unnest(array[new.profile_id, new.partner_profile_id]) x
  where x is not null and exists (
    select 1 from public.tournament_entries e
    where e.tournament_id = t.id and (e.profile_id = x or e.partner_profile_id = x)
  ) limit 1;
  if doublon is not null then
    if doublon = auth.uid() then
      raise exception 'Vous êtes déjà inscrit à ce tournoi.';
    end if;
    raise exception '% est déjà inscrit à ce tournoi.', (select public.nom_affiche(p) from public.profiles p where p.id = doublon);
  end if;

  -- Un invité ne figure qu'une fois (même nom)
  if new.guest_name is not null and exists (
    select 1 from public.tournament_entries e where e.tournament_id = t.id and lower(e.guest_name) = lower(new.guest_name)
  ) then
    raise exception 'Un invité nommé « % » est déjà inscrit.', new.guest_name;
  end if;

  new.added_by := coalesce(auth.uid(), new.added_by);
  return new;
end;
$$;

create or replace function public.ajouter_joueur_en_cours(
  p_tournoi uuid,
  p_profile uuid default null,
  p_invite text default null,
  p_poule int default null,
  p_team_name text default null,
  p_partner_profile uuid default null,
  p_partner_guest text default null
)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  poule int;
  nouveau uuid;
  journee int;
  numero int;
  adv record;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found then raise exception 'Ce tournoi n''existe pas.'; end if;
  if not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut ajouter un joueur en cours de tournoi.';
  end if;
  if t.status <> 'running' then
    raise exception 'Le tournoi n''est pas en cours : ajoutez le joueur normalement.';
  end if;
  if t.format <> 'pools' then
    raise exception 'Impossible en élimination directe : l''arbre est déjà tiré.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final') then
    raise exception 'La phase finale a commencé : on ne peut plus ajouter de joueur.';
  end if;
  -- Poule choisie, sinon la moins remplie
  if p_poule is not null then
    if p_poule < 1 or p_poule > coalesce(t.pools_count, 1) then
      raise exception 'Cette poule n''existe pas.';
    end if;
    poule := p_poule;
  else
    select k into poule from generate_series(1, coalesce(t.pools_count, 1)) k
    order by (select count(*) from public.tournament_entries e where e.tournament_id = p_tournoi and e.pool_no = k), k
    limit 1;
  end if;

  perform set_config('dolina.ajout_en_cours', 'oui', true);
  insert into public.tournament_entries (tournament_id, profile_id, guest_name, team_name, partner_profile_id, partner_guest_name)
  values (p_tournoi, p_profile, case when p_profile is null then p_invite end, p_team_name, p_partner_profile, p_partner_guest)
  returning id into nouveau;
  perform set_config('dolina.ajout_en_cours', '', true);

  perform set_config('dolina.interne', 'oui', true);
  update public.tournament_entries set pool_no = poule,
    seed = (select coalesce(max(seed), 0) + 1 from public.tournament_entries where tournament_id = p_tournoi)
  where id = nouveau;

  -- Ses matchs : contre chaque joueur de la poule, dans une nouvelle journée
  select coalesce(max(round_no), 0) + 1 into journee from public.tournament_matches
   where tournament_id = p_tournoi and phase = 'pool' and pool_no = poule;
  select coalesce(max(match_no), 0) into numero from public.tournament_matches where tournament_id = p_tournoi;
  for adv in select id from public.tournament_entries
             where tournament_id = p_tournoi and pool_no = poule and id <> nouveau order by seed loop
    numero := numero + 1;
    insert into public.tournament_matches (tournament_id, match_no, phase, pool_no, round_no, entry_a, entry_b, status)
    values (p_tournoi, numero, 'pool', poule, journee, adv.id, nouveau, 'ready');
  end loop;
  return nouveau;
end;
$$;
revoke execute on function public.ajouter_joueur_en_cours(uuid, uuid, text, int, text, uuid, text) from public, anon;
grant execute on function public.ajouter_joueur_en_cours(uuid, uuid, text, int, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
