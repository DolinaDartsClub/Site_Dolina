-- =====================================================================
--  Étape 7b : suppression de son compte et export de ses données (RGPD)
--  À exécuter une fois dans Supabase (après 025) : SQL Editor > New query > Run
--
--  Suppression d'un compte (par le joueur lui-même ou par un admin) :
--  - profil, coordonnées, équipes : effacés
--  - parties libres sans aucun autre membre (seul, ou contre des invités) : effacées
--  - parties contre d'autres membres et TOUS les matchs de tournoi :
--    gardées, le joueur y devient « Ancien joueur » (les tableaux et les
--    résultats des autres restent justes)
--  - inscriptions aux tournois pas encore lancés : retirées ;
--    tournois en cours ou terminés : l'inscrit devient « Ancien joueur »
--  - le dernier administrateur du club ne peut pas supprimer son compte
--  La photo de profil est effacée par le site juste avant.
--
--  Export : chaque membre télécharge toutes les données qui le concernent.
-- =====================================================================

-- Suppression commune (interne : appelée par les deux fonctions ci-dessous)
create or replace function public.supprimer_compte(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  -- Inscriptions aux tournois pas encore lancés : retirées
  delete from public.tournament_entries e
   using public.tournaments t
   where t.id = e.tournament_id and t.status in ('draft', 'open') and e.profile_id = p_user;

  -- Parties libres sans aucun autre membre : effacées (jamais un match de tournoi)
  delete from public.games g
  where g.tournament_match_id is null
    and exists (select 1 from public.game_players gp where gp.game_id = g.id and gp.profile_id = p_user)
    and not exists (
      select 1 from public.game_players gp
      where gp.game_id = g.id and gp.profile_id is not null and gp.profile_id <> p_user
    );

  -- Autres parties : le joueur devient « Ancien joueur »
  update public.game_players
     set display_name = 'Ancien joueur', profile_id = null
   where profile_id = p_user;

  -- Le reste (profil, coordonnées, équipes, inscriptions des tournois lancés) suit
  -- automatiquement la suppression du compte
  delete from auth.users where id = p_user;
end;
$$;

revoke all on function public.supprimer_compte(uuid) from public, anon, authenticated;

-- Par le joueur lui-même (« Mon compte »)
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Non connecté.';
  end if;
  if exists (select 1 from public.profiles where id = uid and role = 'admin' and status = 'active')
     and not exists (select 1 from public.profiles where id <> uid and role = 'admin' and status = 'active') then
    raise exception 'Vous êtes le seul administrateur du club : nommez d''abord un autre administrateur avant de supprimer votre compte.';
  end if;
  perform public.supprimer_compte(uid);
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Par un admin (espace admin > Membres)
create or replace function public.admin_delete_account(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;
  if p_user = auth.uid() then
    raise exception 'Pour supprimer votre propre compte, passez par « Mon compte ».';
  end if;
  if exists (select 1 from public.profiles where id = p_user and role = 'admin' and status = 'active') then
    raise exception 'Retirez d''abord le rôle administrateur de ce compte.';
  end if;
  perform public.supprimer_compte(p_user);
end;
$$;

revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;

-- Export de mes données (RGPD : droit d'accès et de portabilité)
create or replace function public.mes_donnees()
returns json language plpgsql stable security definer set search_path = public, auth as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Non connecté.';
  end if;
  return json_build_object(
    'site', 'Dolina Darts Club',
    'date_export', now(),
    'compte', (select json_build_object('email', u.email, 'cree_le', u.created_at) from auth.users u where u.id = uid),
    'profil', (select row_to_json(p) from public.profiles p where p.id = uid),
    'coordonnees', (select row_to_json(c) from public.profile_private c where c.id = uid),
    'equipes', coalesce((select json_agg(json_build_object('equipe', t.name, 'statut', tm.status, 'demande_le', tm.requested_at))
                         from public.team_members tm join public.teams t on t.id = tm.team_id where tm.profile_id = uid), '[]'::json),
    'parties', coalesce((
      select json_agg(json_build_object(
        'partie', row_to_json(g),
        'joueurs', (select json_agg(json_build_object('camp', gp.side, 'nom', gp.display_name, 'moi', gp.profile_id = uid) order by gp.side, gp.throw_order)
                    from public.game_players gp where gp.game_id = g.id),
        'mes_volees', (select coalesce(json_agg(row_to_json(v) order by v.set_no, v.leg_no, v.visit_no), '[]'::json)
                       from public.visits v where v.game_id = g.id
                         and v.side in (select gp.side from public.game_players gp where gp.game_id = g.id and gp.profile_id = uid))
      ) order by g.created_at)
      from public.games g
      where exists (select 1 from public.game_players gp where gp.game_id = g.id and gp.profile_id = uid)), '[]'::json),
    'tournois_inscrit', coalesce((select json_agg(json_build_object('tournoi', t.name, 'statut', t.status, 'inscrit_le', e.created_at,
                                                                    'doublette', e.team_name))
                                  from public.tournament_entries e join public.tournaments t on t.id = e.tournament_id
                                  where e.profile_id = uid or e.partner_profile_id = uid), '[]'::json),
    'tournois_organises', coalesce((select json_agg(json_build_object('tournoi', t.name, 'statut', t.status, 'cree_le', t.created_at))
                                    from public.tournaments t where t.created_by = uid), '[]'::json)
  );
end;
$$;

revoke all on function public.mes_donnees() from public, anon;
grant execute on function public.mes_donnees() to authenticated;

notify pgrst, 'reload schema';
