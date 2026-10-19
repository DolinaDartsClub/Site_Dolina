-- =====================================================================
--  036 – Vice-capitaine
--  Chaque équipe peut avoir un vice-capitaine, avec exactement les mêmes
--  accès que le capitaine (demandes, effectif, calendrier, scores,
--  logos, espace capitaine).
--  Il est choisi par un admin, ou par le capitaine de l'équipe parmi ses
--  joueurs. Le vice-capitaine ne peut pas lui-même changer de vice-capitaine.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 035.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.teams add column if not exists vice_captain_id uuid references public.profiles (id) on delete set null;
alter table public.teams drop constraint if exists teams_vice_different;
alter table public.teams add constraint teams_vice_different check (vice_captain_id is null or vice_captain_id is distinct from captain_id);

-- Capitaine OU vice-capitaine de cette équipe (compte validé)
create or replace function public.is_captain_of(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.teams t
    join public.profiles p on p.id = auth.uid()
    where t.id = p_team and auth.uid() in (t.captain_id, t.vice_captain_id) and p.status = 'active'
  );
$$;

create or replace function public.is_captain_of_requester(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.profile_id = p_profile and auth.uid() in (t.captain_id, t.vice_captain_id)
  );
$$;

create or replace function public.est_capitaine_ou_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.teams t join public.profiles p on p.id = auth.uid()
    where auth.uid() in (t.captain_id, t.vice_captain_id) and p.status = 'active'
  );
$$;

-- Le capitaine et le vice-capitaine désignés deviennent membres de l'équipe
create or replace function public.captain_joins_team()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  qui uuid;
begin
  foreach qui in array array[
    case when new.captain_id is distinct from old.captain_id then new.captain_id end,
    case when new.vice_captain_id is distinct from old.vice_captain_id then new.vice_captain_id end
  ] loop
    if qui is not null then
      insert into public.team_members (team_id, profile_id, status, decided_at, decided_by)
      values (new.id, qui, 'accepted', now(), auth.uid())
      on conflict (team_id, profile_id)
      do update set status = 'accepted', decided_at = now(), decided_by = auth.uid();
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists teams_captain_joins on public.teams;
create trigger teams_captain_joins after update of captain_id, vice_captain_id on public.teams
  for each row execute function public.captain_joins_team();

-- Choisir (ou retirer, p_profile = null) le vice-capitaine d'une équipe
create or replace function public.definir_vice_capitaine(p_team uuid, p_profile uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.teams;
  admin boolean := public.is_admin();
begin
  select * into t from public.teams where id = p_team;
  if t.id is null then
    raise exception 'Équipe introuvable.';
  end if;
  if not admin and not (t.captain_id = auth.uid() and public.is_active_member()) then
    raise exception 'Seuls un admin ou le capitaine de l''équipe peuvent choisir le vice-capitaine.';
  end if;
  if p_profile is not null then
    if p_profile = t.captain_id then
      raise exception 'Le capitaine ne peut pas être aussi vice-capitaine.';
    end if;
    if not exists (select 1 from public.profiles where id = p_profile and status = 'active') then
      raise exception 'Ce membre n''a pas de compte validé.';
    end if;
    -- Le capitaine choisit parmi ses joueurs ; un admin peut choisir n'importe quel membre
    if not admin and not exists (
      select 1 from public.team_members where team_id = p_team and profile_id = p_profile and status = 'accepted'
    ) then
      raise exception 'Choisissez un joueur de l''équipe.';
    end if;
  end if;
  update public.teams set vice_captain_id = p_profile where id = p_team;
end;
$$;
revoke execute on function public.definir_vice_capitaine(uuid, uuid) from public, anon;
grant execute on function public.definir_vice_capitaine(uuid, uuid) to authenticated;

-- Un vice-capitaine qui quitte l'équipe (ou en est retiré) perd son rôle
create or replace function public.vice_quitte_equipe()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or new.status <> 'accepted' then
    update public.teams set vice_captain_id = null
     where id = old.team_id and vice_captain_id = old.profile_id;
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists team_members_vice_quitte on public.team_members;
create trigger team_members_vice_quitte after delete or update of status on public.team_members
  for each row execute function public.vice_quitte_equipe();
