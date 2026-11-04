-- =====================================================================
--  070 – Feuille de match : spectateurs en direct et signature à distance
--  - Tout le monde (même sans compte) peut suivre une feuille par son lien
--    feuille.html?id=… : score en direct, compositions visibles une fois la
--    rencontre lancée. Rien n'est modifiable, signatures non montrées.
--  - Chaque capitaine peut signer sur son propre téléphone (le capitaine
--    adverse par son lien de code), quand les 20 matchs sont terminés.
--    Le capitaine qui gère valide ensuite avec les signatures enregistrées.
--  - Corriger un match après signature efface les signatures.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 069.
--  Peut être relancé sans risque.
-- =====================================================================

-- Lecture : rôle « spectateur » pour tous les autres
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
    else 'spectateur'   -- 070 : tout le monde suit le score en direct
  end;
  select * into r from public.rencontres where id = f.rencontre_id;
  -- 057 : avant le lancement, chaque camp ne voit que sa propre composition
  -- 070 : un spectateur ne voit les compositions qu'une fois la rencontre lancée
  voir_a := f.lancee_le is not null or (role <> 'spectateur' and (role = 'adverse') = (f.notre_camp <> 'A'));
  voir_e := f.lancee_le is not null or (role <> 'spectateur' and (role = 'adverse') = (f.notre_camp <> 'E'));

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
      'signature_a', case when role in ('gerer', 'joueur', 'membre') or (role = 'adverse' and f.notre_camp <> 'A') then f.signature_a end,
      'signature_e', case when role in ('gerer', 'joueur', 'membre') or (role = 'adverse' and f.notre_camp <> 'E') then f.signature_e end,
      'signe_a', f.signature_a is not null, 'signe_e', f.signature_e is not null,
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

-- Validation : reprend les signatures déjà enregistrées
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
  -- 070 : chaque capitaine a pu signer sur son propre téléphone (signer_feuille)
  p_signature_a := coalesce(nullif(p_signature_a, ''), f.signature_a);
  p_signature_e := coalesce(nullif(p_signature_e, ''), f.signature_e);
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

-- Signature d'un capitaine (p_signature vide = effacer)
create or replace function public.signer_feuille(p_feuille uuid default null, p_camp text default null, p_signature text default null, p_code text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  f public.feuilles_match;
begin
  if p_code is not null then
    select * into f from public.feuilles_match where code = upper(trim(p_code)) for update;
    if not found then raise exception 'Ce lien de feuille de match n''est pas valide.'; end if;
    if p_camp is distinct from (case when f.notre_camp = 'A' then 'E' else 'A' end) then
      raise exception 'Vous ne pouvez signer que pour votre équipe.';
    end if;
  else
    select * into f from public.feuilles_match where id = p_feuille for update;
    if not found or not public.feuille_peut_gerer(f.team_id) then
      raise exception 'Seuls les capitaines peuvent signer la feuille de match.';
    end if;
  end if;
  if p_camp is null or p_camp not in ('A', 'E') then raise exception 'Équipe inconnue.'; end if;
  if f.statut = 'validee' then raise exception 'La feuille est déjà validée.'; end if;
  if exists (select 1 from public.feuille_matchs where feuille_id = f.id and statut <> 'termine') then
    raise exception 'La feuille se signe quand les 20 matchs sont terminés.';
  end if;
  if coalesce(p_signature, '') <> '' and (p_signature not like 'data:image/png;base64,%' or char_length(p_signature) > 400000) then
    raise exception 'Signature illisible : recommencez.';
  end if;
  if p_camp = 'A' then
    update public.feuilles_match set signature_a = nullif(p_signature, ''), updated_at = now() where id = f.id;
  else
    update public.feuilles_match set signature_e = nullif(p_signature, ''), updated_at = now() where id = f.id;
  end if;
  return json_build_object('signe', coalesce(p_signature, '') <> '');
end;
$$;

-- Un match corrigé après signature : les signatures ne valent plus
create or replace function public.feuille_signatures_perimees()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.statut, old.manches_a, old.manches_e) is distinct from (new.statut, new.manches_a, new.manches_e) then
    update public.feuilles_match set signature_a = null, signature_e = null
    where id = new.feuille_id and statut <> 'validee' and (signature_a is not null or signature_e is not null);
  end if;
  return new;
end;
$$;
drop trigger if exists feuille_signatures_perimees on public.feuille_matchs;
create trigger feuille_signatures_perimees after update on public.feuille_matchs
  for each row execute function public.feuille_signatures_perimees();

grant execute on function public.feuille_detail(uuid, text) to anon, authenticated;
grant execute on function public.signer_feuille(uuid, text, text, text) to anon, authenticated;
grant execute on function public.valider_feuille(uuid, text, text, boolean) to authenticated;
notify pgrst, 'reload schema';
