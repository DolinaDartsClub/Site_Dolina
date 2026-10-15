-- =====================================================================
--  Suppression d'un tournoi
--  À exécuter une fois dans Supabase (après 026) : SQL Editor > New query > Run
--
--  - un admin peut supprimer n'importe quel tournoi, à tout moment
--    (y compris en cours ou terminé) ;
--  - l'organisateur peut toujours supprimer son tournoi avant le lancement ;
--  - les parties déjà jouées dans le tournoi sont, au choix :
--      supprimées avec lui (p_avec_parties = true),
--      ou gardées comme parties libres (elles restent dans les stats).
-- =====================================================================

create or replace function public.supprimer_tournoi(p_tournoi uuid, p_avec_parties boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  t public.tournaments;
  nb int;
begin
  select * into t from public.tournaments where id = p_tournoi;
  if not found then
    raise exception 'Ce tournoi n''existe pas ou a déjà été supprimé.';
  end if;
  if not (public.is_admin()
          or (t.created_by = auth.uid() and public.is_active_member() and t.status in ('draft', 'open'))) then
    raise exception 'Seul un administrateur peut supprimer un tournoi déjà lancé.';
  end if;

  -- Les verrous des matchs validés ne s'appliquent pas à cette opération
  perform set_config('dolina.interne', 'oui', true);

  if p_avec_parties then
    delete from public.games
     where tournament_match_id in (select id from public.tournament_matches where tournament_id = p_tournoi);
    get diagnostics nb = row_count;
  else
    update public.games set tournament_match_id = null
     where tournament_match_id in (select id from public.tournament_matches where tournament_id = p_tournoi);
    get diagnostics nb = row_count;
  end if;

  delete from public.tournaments where id = p_tournoi;
  perform set_config('dolina.interne', '', true);
  return json_build_object('parties', nb, 'parties_supprimees', p_avec_parties);
end;
$$;

revoke execute on function public.supprimer_tournoi(uuid, boolean) from public, anon;
grant execute on function public.supprimer_tournoi(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
