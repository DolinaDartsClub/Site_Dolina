-- =====================================================================
--  Étape 3 — Administration (à coller dans Supabase › SQL Editor, puis « Run »)
--
--  1. Un admin peut supprimer le compte d'un joueur (mêmes règles RGPD
--     que la suppression par le joueur lui-même).
--  2. Le club ne peut jamais se retrouver sans administrateur.
--  3. Quand un admin désigne un capitaine, celui-ci est automatiquement
--     membre de son équipe.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Suppression d'un compte par un admin
-- ---------------------------------------------------------------------

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

  -- Parties sans aucun autre membre : supprimées
  delete from public.games g
  where exists (select 1 from public.game_players gp where gp.game_id = g.id and gp.profile_id = p_user)
    and not exists (
      select 1 from public.game_players gp
      where gp.game_id = g.id and gp.profile_id is not null and gp.profile_id <> p_user
    );

  -- Parties contre d'autres membres : anonymisées
  update public.game_players
     set display_name = 'Ancien joueur', profile_id = null
   where profile_id = p_user;

  delete from auth.users where id = p_user;
end;
$$;

revoke all on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 2. Toujours au moins un administrateur actif
-- ---------------------------------------------------------------------

create or replace function public.keep_one_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active')
     and not exists (
       select 1 from public.profiles
       where role = 'admin' and status = 'active' and id <> old.id
     ) then
    raise exception 'Le club doit garder au moins un administrateur.';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_keep_one_admin on public.profiles;
create trigger profiles_keep_one_admin before update of role, status on public.profiles
  for each row execute function public.keep_one_admin();


-- ---------------------------------------------------------------------
-- 3. Le capitaine désigné devient membre de son équipe
-- ---------------------------------------------------------------------

create or replace function public.captain_joins_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.captain_id is not null and new.captain_id is distinct from old.captain_id then
    insert into public.team_members (team_id, profile_id, status, decided_at, decided_by)
    values (new.id, new.captain_id, 'accepted', now(), auth.uid())
    on conflict (team_id, profile_id)
    do update set status = 'accepted', decided_at = now(), decided_by = auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists teams_captain_joins on public.teams;
create trigger teams_captain_joins after update of captain_id on public.teams
  for each row execute function public.captain_joins_team();

-- Fin du script.
