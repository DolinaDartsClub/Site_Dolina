-- =====================================================================
--  056 · Feuille de match CPARD (championnat par équipes FFD)
--  - Le capitaine (ou vice-capitaine, ou un admin) ouvre la feuille d'une
--    rencontre du calendrier et saisit la composition de son équipe.
--  - Le capitaine adverse saisit la sienne par un lien (code), sans compte.
--  - 20 matchs dans l'ordre officiel de la feuille FFD : 16 simples et
--    4 doubles, au meilleur des 3 manches de 501, départ direct, finish
--    double ; le joueur qui commence est fixé par la feuille (⊙).
--  - Chaque match se joue dans le scorer ou on saisit seulement les manches.
--  - Un remplaçant par équipe : il prend la place d'un joueur après un match.
--  - 1 point par match gagné ; le capitaine valide (signatures des deux
--    capitaines), le score de la rencontre est reporté au calendrier et un
--    article peut être publié.
--  À exécuter après le script 055.
-- =====================================================================

create table if not exists public.feuilles_match (
  id            uuid primary key default gen_random_uuid(),
  rencontre_id  uuid not null unique references public.rencontres (id) on delete cascade,
  team_id       uuid not null references public.teams (id) on delete cascade,
  notre_camp    text not null default 'E' check (notre_camp in ('A', 'E')),
  code          text not null unique,
  cibles        smallint not null default 2 check (cibles between 1 and 8),
  compo_a       jsonb not null default '{}'::jsonb,
  compo_e       jsonb not null default '{}'::jsonb,
  rempl_a       jsonb,
  rempl_e       jsonb,
  statut        text not null default 'composition' check (statut in ('composition', 'en_cours', 'validee')),
  signature_a   text check (signature_a is null or char_length(signature_a) <= 400000),
  signature_e   text check (signature_e is null or char_length(signature_e) <= 400000),
  article_id    uuid references public.articles (id) on delete set null,
  validee_par   uuid references public.profiles (id) on delete set null,
  validee_le    timestamptz,
  created_by    uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.feuille_matchs (
  id          uuid primary key default gen_random_uuid(),
  feuille_id  uuid not null references public.feuilles_match (id) on delete cascade,
  numero      smallint not null check (numero between 1 and 20),
  statut      text not null default 'a_jouer' check (statut in ('a_jouer', 'en_cours', 'termine')),
  saisie      text check (saisie in ('scorer', 'manches')),
  game_id     uuid references public.games (id) on delete set null,
  manches_a   smallint check (manches_a between 0 and 2),
  manches_e   smallint check (manches_e between 0 and 2),
  joueurs     jsonb,                     -- joueurs réellement alignés, figés au lancement
  updated_at  timestamptz not null default now(),
  unique (feuille_id, numero)
);

alter table public.games add column if not exists feuille_match_id uuid references public.feuille_matchs (id) on delete set null;

-- Tout passe par les fonctions ci-dessous (le code du lien adverse reste secret)
alter table public.feuilles_match enable row level security;
alter table public.feuille_matchs enable row level security;


-- ---------------------------------------------------------------------
-- Ordre officiel des 20 matchs (feuille FFD) : joueur de l'équipe A,
-- joueur de l'équipe E, camp qui commence (⊙)
-- ---------------------------------------------------------------------
create or replace function public.feuille_ordre()
returns table (numero int, poste_a text, poste_e text, premier text)
language sql immutable as $$
  values
    (1, 'A', 'F', 'A'),   (2, 'B', 'E', 'E'),   (3, 'C', 'H', 'A'),   (4, 'D', 'G', 'E'),
    (5, 'A', 'E', 'E'),   (6, 'B', 'F', 'A'),   (7, 'C', 'G', 'E'),   (8, 'D', 'H', 'A'),
    (9, 'A1', 'E1', 'A'), (10, 'A2', 'E2', 'A'),
    (11, 'A', 'G', 'A'),  (12, 'C', 'E', 'A'),  (13, 'B', 'H', 'E'),  (14, 'D', 'F', 'E'),
    (15, 'A', 'H', 'E'),  (16, 'D', 'E', 'A'),  (17, 'B', 'G', 'A'),  (18, 'C', 'F', 'E'),
    (19, 'A1', 'E2', 'E'), (20, 'A2', 'E1', 'E')
$$;


-- ---------------------------------------------------------------------
-- Droits
-- ---------------------------------------------------------------------
create or replace function public.feuille_peut_gerer(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_captain_of(p_team);
$$;

create or replace function public.feuille_peut_jouer(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.feuille_peut_gerer(p_team)
      or (public.is_active_member() and exists (
            select 1 from public.team_members
            where team_id = p_team and profile_id = auth.uid() and status = 'accepted'));
$$;


-- ---------------------------------------------------------------------
-- Joueurs d'un match : remplaçant pris en compte
-- ---------------------------------------------------------------------
create or replace function public.feuille_joueur(f public.feuilles_match, p_camp text, p_poste text, p_numero int)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  compo jsonb := case when p_camp = 'A' then f.compo_a else f.compo_e end;
  rempl jsonb := case when p_camp = 'A' then f.rempl_a else f.rempl_e end;
begin
  if rempl is not null and rempl ->> 'joueur' = p_poste and p_numero > (rempl ->> 'apres')::int then
    return compo -> case when p_camp = 'A' then 'Y' else 'Z' end;
  end if;
  return compo -> p_poste;
end;
$$;

-- Le poste (A, B…) joue-t-il ce match (seul ou dans sa paire de double) ?
create or replace function public.feuille_implique(f public.feuilles_match, p_camp text, p_poste text, p_numero int)
returns boolean language plpgsql stable set search_path = public as $$
declare
  o record;
  pos text;
begin
  select * into o from public.feuille_ordre() x where x.numero = p_numero;
  pos := case when p_camp = 'A' then o.poste_a else o.poste_e end;
  if length(pos) = 2 then
    return coalesce((case when p_camp = 'A' then f.compo_a else f.compo_e end) -> pos, '[]'::jsonb) ? p_poste;
  end if;
  return pos = p_poste;
end;
$$;

-- { "a": [joueur, (partenaire)], "e": [...] } avec joueur = { "p": profil ou null, "n": nom }
create or replace function public.feuille_joueurs_match(f public.feuilles_match, p_numero int)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  o record;
  res jsonb := '{}'::jsonb;
  camp text;
  pos text;
  liste jsonb;
  x text;
begin
  select * into o from public.feuille_ordre() z where z.numero = p_numero;
  foreach camp in array array['A', 'E'] loop
    pos := case when camp = 'A' then o.poste_a else o.poste_e end;
    liste := '[]'::jsonb;
    if length(pos) = 2 then
      for x in select jsonb_array_elements_text(coalesce((case when camp = 'A' then f.compo_a else f.compo_e end) -> pos, '[]'::jsonb)) loop
        liste := liste || jsonb_build_array(coalesce(public.feuille_joueur(f, camp, x, p_numero), 'null'::jsonb));
      end loop;
    else
      liste := jsonb_build_array(coalesce(public.feuille_joueur(f, camp, pos, p_numero), 'null'::jsonb));
    end if;
    res := res || jsonb_build_object(lower(camp), liste);
  end loop;
  return res;
end;
$$;

-- Composition complète ? null si oui, sinon ce qui manque
create or replace function public.feuille_compo_manque(p_compo jsonb, p_camp text)
returns text language plpgsql immutable as $$
declare
  lettres text[] := case when p_camp = 'A' then array['A','B','C','D'] else array['E','F','G','H'] end;
  paires text[] := case when p_camp = 'A' then array['A1','A2'] else array['E1','E2'] end;
  l text;
  paire jsonb;
begin
  foreach l in array lettres loop
    if coalesce(trim(p_compo -> l ->> 'n'), '') = '' then
      return 'le joueur ' || l;
    end if;
  end loop;
  foreach l in array paires loop
    paire := p_compo -> l;
    if jsonb_typeof(paire) is distinct from 'array' or jsonb_array_length(paire) <> 2
       or paire ->> 0 = paire ->> 1
       or not (paire ->> 0 = any (lettres)) or not (paire ->> 1 = any (lettres)) then
      return 'le double ' || l;
    end if;
  end loop;
  return null;
end;
$$;


-- ---------------------------------------------------------------------
-- Création, détail, liste
-- ---------------------------------------------------------------------
create or replace function public.creer_feuille(p_rencontre uuid, p_notre_camp text default 'E', p_cibles int default 2)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  r public.rencontres;
  id_f uuid;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  select * into r from public.rencontres where id = p_rencontre;
  if not found then
    raise exception 'Cette rencontre n''existe pas.';
  end if;
  if not public.feuille_peut_gerer(r.team_id) then
    raise exception 'Seuls le capitaine, le vice-capitaine de l''équipe et les admins peuvent ouvrir la feuille de match.';
  end if;
  select id into id_f from public.feuilles_match where rencontre_id = r.id;
  if found then
    return id_f;                     -- déjà ouverte : on la rouvre
  end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') into c
    from generate_series(1, 10);
    exit when not exists (select 1 from public.feuilles_match where code = c);
  end loop;
  insert into public.feuilles_match (rencontre_id, team_id, notre_camp, code, cibles)
  values (r.id, r.team_id, case when p_notre_camp = 'A' then 'A' else 'E' end, c, least(greatest(coalesce(p_cibles, 2), 1), 8))
  returning id into id_f;
  insert into public.feuille_matchs (feuille_id, numero) select id_f, n from generate_series(1, 20) n;
  return id_f;
end;
$$;

create or replace function public.feuille_detail(p_feuille uuid default null, p_code text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  f public.feuilles_match;
  r public.rencontres;
  role text;
begin
  if p_code is not null then
    select * into f from public.feuilles_match where code = upper(trim(p_code));
    if not found then
      raise exception 'Ce lien de feuille de match n''est pas valide.';
    end if;
  else
    select * into f from public.feuilles_match where id = p_feuille;
    if not found then
      raise exception 'Cette feuille de match n''existe pas.';
    end if;
  end if;
  role := case
    when public.feuille_peut_gerer(f.team_id) then 'gerer'
    when public.feuille_peut_jouer(f.team_id) then 'joueur'
    when p_code is not null then 'adverse'
    when public.is_active_member() then 'membre'
  end;
  if role is null then
    raise exception 'Cette feuille de match est réservée aux membres du club.';
  end if;
  select * into r from public.rencontres where id = f.rencontre_id;

  return json_build_object(
    'role', role,
    'feuille', json_build_object(
      'id', f.id, 'code', case when role = 'gerer' then f.code end,
      'notre_camp', f.notre_camp, 'cibles', f.cibles, 'statut', f.statut,
      'compo_a', f.compo_a, 'compo_e', f.compo_e, 'rempl_a', f.rempl_a, 'rempl_e', f.rempl_e,
      'signature_a', case when role <> 'adverse' then f.signature_a end,
      'signature_e', case when role <> 'adverse' then f.signature_e end,
      'article_id', f.article_id, 'validee_le', f.validee_le,
      'manque_a', public.feuille_compo_manque(f.compo_a, 'A'), 'manque_e', public.feuille_compo_manque(f.compo_e, 'E')),
    'rencontre', json_build_object(
      'id', r.id, 'date_match', r.date_match, 'heure_match', r.heure_match, 'domicile', r.domicile,
      'adversaire', r.adversaire, 'division', r.division, 'poule', r.poule, 'journee', r.journee,
      'salle', (select json_build_object('nom', s.nom, 'adresse', s.adresse) from public.salles s where s.id = r.salle_id)),
    'equipe', (select json_build_object('id', t.id, 'name', t.name, 'logo', t.logo) from public.teams t where t.id = f.team_id),
    'matchs', (select json_agg(json_build_object(
        'numero', m.numero, 'statut', m.statut, 'saisie', m.saisie, 'game_id', m.game_id,
        'manches_a', m.manches_a, 'manches_e', m.manches_e,
        'joueurs', coalesce(m.joueurs, public.feuille_joueurs_match(f, m.numero))) order by m.numero)
      from public.feuille_matchs m where m.feuille_id = f.id),
    -- Joueurs de l'équipe (pour composer) : effectif validé
    'effectif', case when role in ('gerer', 'joueur') then (select json_agg(json_build_object(
        'id', p.id, 'nom', p.first_name || ' ' || p.last_name, 'affiche', public.nom_affiche(p)) order by p.first_name, p.last_name)
      from public.team_members tm join public.profiles p on p.id = tm.profile_id
      where tm.team_id = f.team_id and tm.status = 'accepted' and p.status = 'active') end
  );
end;
$$;

-- Feuilles des rencontres données (bouton sur la page Équipes)
create or replace function public.feuilles_rencontres(p_rencontres uuid[])
returns table (rencontre_id uuid, feuille_id uuid, statut text)
language sql stable security definer set search_path = public as $$
  select f.rencontre_id, f.id, f.statut from public.feuilles_match f
  where f.rencontre_id = any (p_rencontres) and public.is_active_member();
$$;


-- ---------------------------------------------------------------------
-- Composition (capitaine ; capitaine adverse par le lien)
-- ---------------------------------------------------------------------
create or replace function public.enregistrer_compo(p_feuille uuid, p_camp text, p_compo jsonb, p_code text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  gerer boolean;
  lettres text[];
  propre jsonb := '{}'::jsonb;
  l text;
  j jsonb;
  pr public.profiles;
  nom text;
  vus uuid[] := '{}';
begin
  if p_code is not null then
    select * into f from public.feuilles_match where code = upper(trim(p_code)) for update;
  else
    select * into f from public.feuilles_match where id = p_feuille for update;
  end if;
  if not found then
    raise exception 'Cette feuille de match n''existe pas.';
  end if;
  if p_camp not in ('A', 'E') then
    raise exception 'Équipe inconnue.';
  end if;
  gerer := public.feuille_peut_gerer(f.team_id);
  if not gerer then
    if p_code is null or upper(trim(p_code)) <> f.code then
      raise exception 'Seul le capitaine peut modifier la composition.';
    end if;
    if p_camp = f.notre_camp then
      raise exception 'Vous ne pouvez saisir que la composition de votre équipe.';
    end if;
    if exists (select 1 from public.feuille_matchs where feuille_id = f.id and statut <> 'a_jouer') then
      raise exception 'Les matchs ont commencé : demandez au capitaine qui reçoit de corriger la composition.';
    end if;
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est validée : elle ne se modifie plus.';
  end if;

  lettres := case when p_camp = 'A' then array['A','B','C','D','Y'] else array['E','F','G','H','Z'] end;
  foreach l in array lettres loop
    j := p_compo -> l;
    if j is null or jsonb_typeof(j) <> 'object' then
      continue;
    end if;
    -- Un membre du club (notre équipe seulement), sinon un nom libre
    if p_camp = f.notre_camp and nullif(j ->> 'p', '') is not null then
      select * into pr from public.profiles where id = (j ->> 'p')::uuid and status = 'active';
      if not found then
        raise exception 'Joueur % introuvable.', l;
      end if;
      if pr.id = any (vus) then
        raise exception '% est inscrit deux fois dans la composition.', pr.first_name || ' ' || pr.last_name;
      end if;
      vus := vus || pr.id;
      propre := propre || jsonb_build_object(l, jsonb_build_object('p', pr.id, 'n', left(pr.first_name || ' ' || pr.last_name, 40)));
    else
      nom := left(regexp_replace(trim(coalesce(j ->> 'n', '')), '\s+', ' ', 'g'), 40);
      if nom <> '' then
        propre := propre || jsonb_build_object(l, jsonb_build_object('p', null, 'n', nom));
      end if;
    end if;
  end loop;
  foreach l in array case when p_camp = 'A' then array['A1','A2'] else array['E1','E2'] end loop
    j := p_compo -> l;
    if jsonb_typeof(j) = 'array' then
      -- Ordre gardé (le premier nommé lance en premier), doublons retirés
      propre := propre || jsonb_build_object(l, (select coalesce(jsonb_agg(x order by o), '[]'::jsonb) from (
        select distinct on (x) x, o from jsonb_array_elements_text(j) with ordinality t(x, o)
        where x = any (lettres[1:4]) order by x, o) d));
    end if;
  end loop;

  if p_camp = 'A' then
    update public.feuilles_match set compo_a = propre, updated_at = now() where id = f.id;
  else
    update public.feuilles_match set compo_e = propre, updated_at = now() where id = f.id;
  end if;
end;
$$;

create or replace function public.definir_cibles_feuille(p_feuille uuid, p_cibles int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
begin
  select * into f from public.feuilles_match where id = p_feuille;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut choisir le nombre de cibles.';
  end if;
  update public.feuilles_match set cibles = least(greatest(coalesce(p_cibles, 1), 1), 8), updated_at = now() where id = f.id;
end;
$$;

-- Remplaçant : prend la place de p_joueur pour les matchs après p_apres ; p_joueur null = aucun
create or replace function public.definir_remplacement(p_feuille uuid, p_camp text, p_joueur text, p_apres int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  ancien jsonb;
  nouveau jsonb;
  lettres text[] := case when p_camp = 'A' then array['A','B','C','D'] else array['E','F','G','H'] end;
  r jsonb;
  bloque text;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut enregistrer un remplacement.';
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est validée : elle ne se modifie plus.';
  end if;
  ancien := case when p_camp = 'A' then f.rempl_a else f.rempl_e end;
  if p_joueur is not null then
    if not (p_joueur = any (lettres)) or p_apres is null or p_apres not between 0 and 19 then
      raise exception 'Remplacement incomplet : choisissez le joueur remplacé et le match après lequel il sort.';
    end if;
    if coalesce(trim((case when p_camp = 'A' then f.compo_a else f.compo_e end) -> case when p_camp = 'A' then 'Y' else 'Z' end ->> 'n'), '') = '' then
      raise exception 'Indiquez d''abord le remplaçant (%) dans la composition.', case when p_camp = 'A' then 'Y' else 'Z' end;
    end if;
    nouveau := jsonb_build_object('joueur', p_joueur, 'apres', p_apres);
  end if;
  -- Les matchs concernés (ancien et nouveau remplacement) ne doivent pas avoir commencé
  foreach r in array array[ancien, nouveau] loop
    continue when r is null;
    select string_agg('#' || m.numero, ', ' order by m.numero) into bloque
    from public.feuille_matchs m
    where m.feuille_id = f.id and m.statut <> 'a_jouer' and m.numero > (r ->> 'apres')::int
      and public.feuille_implique(f, p_camp, r ->> 'joueur', m.numero);
    if bloque is not null then
      raise exception 'Le joueur % a déjà commencé ou joué le match %: choisissez un match plus tard.', r ->> 'joueur', bloque;
    end if;
  end loop;
  if p_camp = 'A' then
    update public.feuilles_match set rempl_a = nouveau, updated_at = now() where id = f.id;
  else
    update public.feuilles_match set rempl_e = nouveau, updated_at = now() where id = f.id;
  end if;
end;
$$;


-- ---------------------------------------------------------------------
-- Jouer les matchs
-- ---------------------------------------------------------------------
create or replace function public.feuille_verifier_jouable(f public.feuilles_match, m public.feuille_matchs)
returns void language plpgsql stable set search_path = public as $$
declare
  manque text;
begin
  if not public.feuille_peut_jouer(f.team_id) then
    raise exception 'Seuls les joueurs et le capitaine de l''équipe peuvent saisir les matchs.';
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est validée : elle ne se modifie plus.';
  end if;
  manque := coalesce('équipe A : ' || public.feuille_compo_manque(f.compo_a, 'A'), 'équipe E : ' || public.feuille_compo_manque(f.compo_e, 'E'));
  if manque is not null then
    raise exception 'Composition incomplète (%) : complétez-la avant de jouer.', manque;
  end if;
end;
$$;

create or replace function public.lancer_match_feuille(p_feuille uuid, p_numero int)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  m public.feuille_matchs;
  o record;
  j jsonb;
  g uuid;
  cote int;
  liste jsonb;
  x jsonb;
  k int;
  occupe text;
  equipe text;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found then
    raise exception 'Cette feuille de match n''existe pas.';
  end if;
  select * into m from public.feuille_matchs where feuille_id = f.id and numero = p_numero for update;
  perform public.feuille_verifier_jouable(f, m);
  if m.statut = 'en_cours' then
    raise exception 'Ce match est déjà en cours dans le scorer.';
  elsif m.statut = 'termine' then
    raise exception 'Ce match est déjà terminé.';
  end if;
  select * into o from public.feuille_ordre() z where z.numero = p_numero;
  j := public.feuille_joueurs_match(f, p_numero);

  -- Un joueur ne joue qu'un match à la fois
  select string_agg(distinct x2 ->> 'n', ' et ') into occupe
  from public.feuille_matchs o2, jsonb_array_elements(o2.joueurs -> 'a') x2
  where o2.feuille_id = f.id and o2.statut = 'en_cours' and (j -> 'a') @> jsonb_build_array(x2);
  if occupe is null then
    select string_agg(distinct x2 ->> 'n', ' et ') into occupe
    from public.feuille_matchs o2, jsonb_array_elements(o2.joueurs -> 'e') x2
    where o2.feuille_id = f.id and o2.statut = 'en_cours' and (j -> 'e') @> jsonb_build_array(x2);
  end if;
  if occupe is not null then
    raise exception '% joue déjà un autre match : terminez-le avant de lancer celui-ci.', occupe;
  end if;

  select t.name into equipe from public.teams t where t.id = f.team_id;
  perform set_config('dolina.interne', 'oui', true);
  insert into public.games (created_by, variant, start_score, mode, legs_kind, legs_n, visibility,
                            first_side, show_checkout, match_type, feuille_match_id)
  values (auth.uid(), '501', 501, case when length(o.poste_a) = 2 then 'double' else 'single' end,
          'best_of', 3, 'public', case when o.premier = 'A' then 1 else 2 end, false, 'ligue', m.id)
  returning id into g;
  -- Camp 1 = équipe A, camp 2 = équipe E
  for cote in 1..2 loop
    liste := j -> case when cote = 1 then 'a' else 'e' end;
    insert into public.game_sides (game_id, side, name)
    values (g, cote, case when jsonb_array_length(liste) = 2 then left(
      case when (cote = 1) = (f.notre_camp = 'A') then equipe
           else (select r.adversaire from public.rencontres r where r.id = f.rencontre_id) end, 40) end);
    k := 0;
    for x in select * from jsonb_array_elements(liste) loop
      k := k + 1;
      insert into public.game_players (game_id, side, profile_id, guest_name, throw_order)
      values (g, cote, nullif(x ->> 'p', '')::uuid, case when nullif(x ->> 'p', '') is null then left(coalesce(x ->> 'n', 'Joueur'), 40) end, k);
    end loop;
  end loop;
  update public.feuille_matchs set statut = 'en_cours', saisie = 'scorer', game_id = g, joueurs = j, updated_at = now() where id = m.id;
  update public.feuilles_match set statut = 'en_cours', updated_at = now() where id = f.id and statut = 'composition';
  perform set_config('dolina.interne', '', true);
  return g;
end;
$$;

-- Fin de partie dans le scorer : les manches gagnées vont sur la feuille
create or replace function public.valider_match_feuille(p_game uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games;
  m public.feuille_matchs;
  f public.feuilles_match;
  la int; le int;
begin
  select * into g from public.games where id = p_game;
  if not found or g.feuille_match_id is null then
    raise exception 'Cette partie n''est pas un match de feuille de match.';
  end if;
  select * into m from public.feuille_matchs where id = g.feuille_match_id for update;
  select * into f from public.feuilles_match where id = m.feuille_id;
  if not (g.created_by = auth.uid() or public.feuille_peut_gerer(f.team_id)) then
    raise exception 'Seuls la personne qui a tenu le score et le capitaine peuvent valider ce résultat.';
  end if;
  if m.statut = 'termine' then
    return;
  end if;
  if m.game_id is distinct from g.id then
    raise exception 'Ce match n''attend pas de validation.';
  end if;
  if g.status <> 'finished' or g.winner_side is null then
    raise exception 'La partie n''est pas terminée : terminez-la dans le scorer avant de valider.';
  end if;
  select count(*) filter (where side = 1), count(*) filter (where side = 2) into la, le
  from public.visits where game_id = g.id and is_checkout;
  update public.feuille_matchs set statut = 'termine', manches_a = least(la, 2), manches_e = least(le, 2), updated_at = now()
  where id = m.id;
end;
$$;

-- Saisie rapide : seulement les manches (2-0, 2-1, 1-2, 0-2)
create or replace function public.saisir_resultat_feuille(p_feuille uuid, p_numero int, p_manches_a int, p_manches_e int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  m public.feuille_matchs;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found then
    raise exception 'Cette feuille de match n''existe pas.';
  end if;
  select * into m from public.feuille_matchs where feuille_id = f.id and numero = p_numero for update;
  perform public.feuille_verifier_jouable(f, m);
  if not (greatest(p_manches_a, p_manches_e) = 2 and least(p_manches_a, p_manches_e) in (0, 1)) then
    raise exception 'Score impossible : un match se gagne 2-0 ou 2-1.';
  end if;
  if m.statut = 'en_cours' then
    raise exception 'Ce match est en cours dans le scorer : terminez-le ou abandonnez-le d''abord.';
  end if;
  if m.statut = 'termine' and m.saisie = 'scorer' and m.game_id is not null then
    raise exception 'Ce match a été joué dans le scorer : remettez-le à jouer pour saisir un autre score.';
  end if;
  update public.feuille_matchs set statut = 'termine', saisie = 'manches', manches_a = p_manches_a, manches_e = p_manches_e,
    joueurs = public.feuille_joueurs_match(f, p_numero), game_id = null, updated_at = now()
  where id = m.id;
  update public.feuilles_match set statut = 'en_cours', updated_at = now() where id = f.id and statut = 'composition';
end;
$$;

-- Corriger : le match redevient « à jouer » (sa partie du scorer est effacée)
create or replace function public.remettre_match_feuille(p_feuille uuid, p_numero int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  m public.feuille_matchs;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut remettre un match à jouer.';
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est validée : rouvrez-la d''abord.';
  end if;
  select * into m from public.feuille_matchs where feuille_id = f.id and numero = p_numero for update;
  perform set_config('dolina.interne', 'oui', true);
  if m.game_id is not null then
    delete from public.games where id = m.game_id;
  end if;
  update public.feuille_matchs set statut = 'a_jouer', saisie = null, game_id = null, manches_a = null, manches_e = null,
    joueurs = null, updated_at = now() where id = m.id;
  perform set_config('dolina.interne', '', true);
end;
$$;


-- ---------------------------------------------------------------------
-- Validation, réouverture, suppression
-- ---------------------------------------------------------------------
create or replace function public.valider_feuille(p_feuille uuid, p_signature_a text, p_signature_e text, p_article boolean default true)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  r public.rencontres;
  equipe text;
  pa int; pe int; ma int; me int;
  nous int; eux int;
  art uuid;
  titre text;
  phrase text;
  contexte text;
  poule text;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut valider la feuille de match.';
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est déjà validée.';
  end if;
  if exists (select 1 from public.feuille_matchs where feuille_id = f.id and statut <> 'termine') then
    raise exception 'Tous les matchs ne sont pas terminés.';
  end if;
  if coalesce(p_signature_a, '') = '' or coalesce(p_signature_e, '') = '' then
    raise exception 'Les deux capitaines doivent signer la feuille.';
  end if;
  select count(*) filter (where manches_a > manches_e), count(*) filter (where manches_e > manches_a),
         sum(manches_a), sum(manches_e)
    into pa, pe, ma, me
  from public.feuille_matchs where feuille_id = f.id;
  nous := case when f.notre_camp = 'A' then pa else pe end;
  eux := case when f.notre_camp = 'A' then pe else pa end;

  select * into r from public.rencontres where id = f.rencontre_id;
  select name into equipe from public.teams where id = f.team_id;
  update public.rencontres set score_nous = nous, score_eux = eux, updated_at = now() where id = r.id;

  if p_article then
    poule := concat_ws(' · ', 'Division ' || nullif(r.division, ''), 'Poule ' || nullif(r.poule, ''));
    contexte := coalesce('Journée ' || regexp_replace(nullif(r.journee, ''), '^[Jj]', ''), 'Championnat')
             || ' du championnat par équipes CPARD' || case when poule <> '' then ' (' || poule || ')' else '' end;
    titre := case when nous > eux then 'Victoire de ' || equipe || ' face à ' || r.adversaire
                  when nous < eux then 'Défaite de ' || equipe || ' face à ' || r.adversaire
                  else 'Match nul entre ' || equipe || ' et ' || r.adversaire end || ' (' || nous || '-' || eux || ')';
    phrase := case when nous > eux then equipe || ' s''impose ' || nous || ' à ' || eux
                   when nous < eux then equipe || ' s''incline ' || nous || ' à ' || eux
                   else equipe || ' et ' || r.adversaire || ' se quittent sur un nul, ' || nous || ' partout' end
           || case when r.domicile then ' à domicile' else ' chez ' || r.adversaire end || '.';
    insert into public.articles (title, body, category, published, published_at, author_id, team_id)
    values (left(titre, 160),
            contexte || ' : ' || phrase || E'\n\nManches gagnées : '
              || case when f.notre_camp = 'A' then ma else me end || ' contre ' || case when f.notre_camp = 'A' then me else ma end || '.'
              || E'\n\nBravo à toute l''équipe !',
            'resultat', true, now(), auth.uid(), f.team_id)
    returning id into art;
  end if;

  update public.feuilles_match set statut = 'validee', signature_a = p_signature_a, signature_e = p_signature_e,
    validee_par = auth.uid(), validee_le = now(), article_id = coalesce(art, article_id), updated_at = now()
  where id = f.id;
  return json_build_object('score_nous', nous, 'score_eux', eux, 'article_id', art);
end;
$$;

create or replace function public.rouvrir_feuille(p_feuille uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut rouvrir la feuille de match.';
  end if;
  update public.feuilles_match set statut = 'en_cours', signature_a = null, signature_e = null,
    validee_par = null, validee_le = null, updated_at = now()
  where id = f.id and statut = 'validee';
end;
$$;

-- Supprimer une feuille non validée (les parties jouées restent dans les stats)
create or replace function public.supprimer_feuille(p_feuille uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut supprimer la feuille de match.';
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est validée : rouvrez-la avant de la supprimer.';
  end if;
  perform set_config('dolina.interne', 'oui', true);
  delete from public.games where status = 'live'
    and feuille_match_id in (select id from public.feuille_matchs where feuille_id = f.id);
  delete from public.feuilles_match where id = f.id;
  perform set_config('dolina.interne', '', true);
end;
$$;


-- ---------------------------------------------------------------------
-- Verrous et synchronisation avec le scorer
-- ---------------------------------------------------------------------

-- Les parties d'une feuille ne se créent que par lancer_match_feuille
create or replace function public.lien_feuille_protege()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.feuille_match_id is not null and coalesce(current_setting('dolina.interne', true), '') <> 'oui' then
    raise exception 'Un match de feuille de match se lance depuis la feuille.';
  end if;
  return new;
end;
$$;
drop trigger if exists parties_lien_feuille on public.games;
create trigger parties_lien_feuille before insert on public.games
  for each row execute function public.lien_feuille_protege();

-- Partie abandonnée ou supprimée : le match redevient « à jouer »
create or replace function public.partie_feuille_retiree()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.feuille_match_id is null then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' or new.status = 'abandoned' then
    update public.feuille_matchs set statut = 'a_jouer', saisie = null, game_id = null, joueurs = null
     where id = old.feuille_match_id and statut = 'en_cours';
    if tg_op = 'UPDATE' then
      new.feuille_match_id := null;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists parties_feuille_suppression on public.games;
create trigger parties_feuille_suppression before delete on public.games
  for each row execute function public.partie_feuille_retiree();
drop trigger if exists parties_feuille_abandon on public.games;
create trigger parties_feuille_abandon before update of status on public.games
  for each row when (new.status = 'abandoned') execute function public.partie_feuille_retiree();

-- Résultat reporté sur la feuille : la partie ne se modifie plus
create or replace function public.verrou_partie_feuille()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  idg uuid := coalesce(new.game_id, old.game_id);
begin
  if coalesce(current_setting('dolina.interne', true), '') = 'oui' then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.games g join public.feuille_matchs m on m.id = g.feuille_match_id
             where g.id = idg and m.statut = 'termine') then
    raise exception 'Résultat reporté sur la feuille de match : la partie ne peut plus être modifiée. Le capitaine peut remettre le match à jouer.';
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists visites_verrou_feuille on public.visits;
create trigger visites_verrou_feuille before insert or update or delete on public.visits
  for each row execute function public.verrou_partie_feuille();


grant execute on function public.creer_feuille(uuid, text, int) to authenticated;
grant execute on function public.feuille_detail(uuid, text) to anon, authenticated;
grant execute on function public.feuilles_rencontres(uuid[]) to authenticated;
grant execute on function public.enregistrer_compo(uuid, text, jsonb, text) to anon, authenticated;
grant execute on function public.definir_cibles_feuille(uuid, int) to authenticated;
grant execute on function public.definir_remplacement(uuid, text, text, int) to authenticated;
grant execute on function public.lancer_match_feuille(uuid, int) to authenticated;
grant execute on function public.valider_match_feuille(uuid) to authenticated;
grant execute on function public.saisir_resultat_feuille(uuid, int, int, int) to authenticated;
grant execute on function public.remettre_match_feuille(uuid, int) to authenticated;
grant execute on function public.valider_feuille(uuid, text, text, boolean) to authenticated;
grant execute on function public.rouvrir_feuille(uuid) to authenticated;
grant execute on function public.supprimer_feuille(uuid) to authenticated;

-- Le scorer retrouve la feuille d'une partie (retour et validation du match)
create or replace function public.feuille_de_partie(p_game uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('feuille_id', m.feuille_id, 'numero', m.numero, 'statut', m.statut)
  from public.games g join public.feuille_matchs m on m.id = g.feuille_match_id
  where g.id = p_game;
$$;
grant execute on function public.feuille_de_partie(uuid) to anon, authenticated;
