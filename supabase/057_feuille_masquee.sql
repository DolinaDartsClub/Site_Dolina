-- =====================================================================
--  057 · Feuille de match : compositions masquées jusqu'au lancement
--  Chaque capitaine saisit (envoie) son équipe sans voir celle d'en face.
--  Le capitaine qui reçoit lance la rencontre quand les deux équipes sont
--  complètes : les deux compositions deviennent visibles et les matchs
--  peuvent commencer. Tant qu'aucun match n'est joué, il peut annuler le
--  lancement (les compositions sont de nouveau masquées et modifiables).
--  À exécuter après le script 056.
-- =====================================================================

alter table public.feuilles_match add column if not exists lancee_le timestamptz;
-- Feuilles déjà commencées : considérées comme lancées
update public.feuilles_match set lancee_le = coalesce(lancee_le, updated_at) where statut <> 'composition';

create or replace function public.lancer_rencontre(p_feuille uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
  manque text;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut lancer la rencontre.';
  end if;
  if f.lancee_le is not null then
    return;
  end if;
  manque := coalesce('équipe A : ' || public.feuille_compo_manque(f.compo_a, 'A'), 'équipe E : ' || public.feuille_compo_manque(f.compo_e, 'E'));
  if manque is not null then
    raise exception 'Les deux équipes doivent être complètes avant le lancement (%).', manque;
  end if;
  update public.feuilles_match set lancee_le = now(), statut = 'en_cours', updated_at = now() where id = f.id;
end;
$$;

create or replace function public.annuler_lancement_feuille(p_feuille uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
begin
  select * into f from public.feuilles_match where id = p_feuille for update;
  if not found or not public.feuille_peut_gerer(f.team_id) then
    raise exception 'Seul le capitaine peut annuler le lancement.';
  end if;
  if exists (select 1 from public.feuille_matchs where feuille_id = f.id and statut <> 'a_jouer') then
    raise exception 'Des matchs ont déjà commencé : le lancement ne peut plus être annulé.';
  end if;
  update public.feuilles_match set lancee_le = null, statut = 'composition', rempl_a = null, rempl_e = null, updated_at = now()
  where id = f.id and statut <> 'validee';
end;
$$;

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
  if f.lancee_le is null then
    raise exception 'La rencontre n''est pas encore lancée : le capitaine qui reçoit la lance une fois les deux équipes saisies.';
  end if;
  manque := coalesce('équipe A : ' || public.feuille_compo_manque(f.compo_a, 'A'), 'équipe E : ' || public.feuille_compo_manque(f.compo_e, 'E'));
  if manque is not null then
    raise exception 'Composition incomplète (%) : complétez-la avant de jouer.', manque;
  end if;
end;
$$;

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
    if f.lancee_le is not null then
      raise exception 'La rencontre est lancée : demandez au capitaine qui reçoit de corriger la composition.';
    end if;
  elsif p_camp <> f.notre_camp and f.lancee_le is null then
    -- 057 : compositions masquées l'une de l'autre jusqu'au lancement
    raise exception 'La composition adverse est saisie par son capitaine avec le lien. Vous pourrez la corriger après le lancement de la rencontre.';
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
  if f.lancee_le is null then
    raise exception 'Lancez d''abord la rencontre : les remplacements se font pendant les matchs.';
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

create or replace function public.feuille_detail(p_feuille uuid default null, p_code text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  f public.feuilles_match;
  r public.rencontres;
  role text;
  voir_a boolean;
  voir_e boolean;
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
  -- 057 : avant le lancement, chaque camp ne voit que sa propre composition
  voir_a := f.lancee_le is not null or ((role = 'adverse') = (f.notre_camp <> 'A'));
  voir_e := f.lancee_le is not null or ((role = 'adverse') = (f.notre_camp <> 'E'));

  return json_build_object(
    'role', role,
    'feuille', json_build_object(
      'id', f.id, 'code', case when role = 'gerer' then f.code end,
      'notre_camp', f.notre_camp, 'cibles', f.cibles, 'statut', f.statut,
      'lancee_le', f.lancee_le, 'voir_a', voir_a, 'voir_e', voir_e,
      'compo_a', case when voir_a then f.compo_a else '{}'::jsonb end,
      'compo_e', case when voir_e then f.compo_e else '{}'::jsonb end,
      'rempl_a', case when voir_a then f.rempl_a end, 'rempl_e', case when voir_e then f.rempl_e end,
      'pret_a', public.feuille_compo_manque(f.compo_a, 'A') is null, 'pret_e', public.feuille_compo_manque(f.compo_e, 'E') is null,
      'signature_a', case when role <> 'adverse' then f.signature_a end,
      'signature_e', case when role <> 'adverse' then f.signature_e end,
      'article_id', f.article_id, 'validee_le', f.validee_le,
      'manque_a', case when voir_a then public.feuille_compo_manque(f.compo_a, 'A') end,
      'manque_e', case when voir_e then public.feuille_compo_manque(f.compo_e, 'E') end),
    'rencontre', json_build_object(
      'id', r.id, 'date_match', r.date_match, 'heure_match', r.heure_match, 'domicile', r.domicile,
      'adversaire', r.adversaire, 'division', r.division, 'poule', r.poule, 'journee', r.journee,
      'salle', (select json_build_object('nom', s.nom, 'adresse', s.adresse) from public.salles s where s.id = r.salle_id)),
    'equipe', (select json_build_object('id', t.id, 'name', t.name, 'logo', t.logo) from public.teams t where t.id = f.team_id),
    'matchs', (select json_agg(json_build_object(
        'numero', m.numero, 'statut', m.statut, 'saisie', m.saisie, 'game_id', m.game_id,
        'manches_a', m.manches_a, 'manches_e', m.manches_e,
        'joueurs', (select jsonb_build_object('a', case when voir_a then j -> 'a' end, 'e', case when voir_e then j -> 'e' end)
                    from (select coalesce(m.joueurs, public.feuille_joueurs_match(f, m.numero)) j) x)) order by m.numero)
      from public.feuille_matchs m where m.feuille_id = f.id),
    -- Joueurs de l'équipe (pour composer) : effectif validé
    'effectif', case when role in ('gerer', 'joueur') then (select json_agg(json_build_object(
        'id', p.id, 'nom', p.first_name || ' ' || p.last_name, 'affiche', public.nom_affiche(p)) order by p.first_name, p.last_name)
      from public.team_members tm join public.profiles p on p.id = tm.profile_id
      where tm.team_id = f.team_id and tm.status = 'accepted' and p.status = 'active') end
  );
end;
$$;

grant execute on function public.lancer_rencontre(uuid) to authenticated;
grant execute on function public.annuler_lancement_feuille(uuid) to authenticated;
