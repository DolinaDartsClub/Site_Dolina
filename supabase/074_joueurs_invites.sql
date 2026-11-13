-- =====================================================================
--  074 – Répertoire des joueurs invités (sans compte)
--  Chaque nom d'invité saisi sur le site est gardé automatiquement :
--  partie (Jouer), tournoi / ligue (participants et partenaires de
--  doublette), feuille de match CPARD (joueurs de NOTRE équipe saisis
--  à la main). Les membres le retrouvent ensuite par la recherche, partout
--  où l'on ajoute un joueur. Un même nom (casse et accents ignorés) n'est
--  enregistré qu'une fois.
--  Lecture : membres actifs. Renommer / supprimer : admin.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 073.
--  Peut être relancé sans risque.
-- =====================================================================

-- Clé de comparaison : minuscules, sans accents, espaces simplifiés
create or replace function public.cle_nom(p text)
returns text language sql immutable as $$
  select regexp_replace(lower(translate(btrim(coalesce(p, '')),
    'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖØòóôõöøÙÚÛÜùúûüÝýÿŒœÆæ',
    'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOOooooooUUUUuuuuYyyOoAa')), '\s+', ' ', 'g');
$$;

create table if not exists public.joueurs_invites (
  id              uuid primary key default gen_random_uuid(),
  nom             text not null check (char_length(btrim(nom)) between 1 and 40),
  cle             text not null unique,
  team_id         uuid references public.teams(id) on delete set null,  -- dernière équipe où il a joué
  nb_utilisations int not null default 1,
  cree_le         timestamptz not null default now(),
  utilise_le      timestamptz not null default now()
);
alter table public.joueurs_invites enable row level security;
drop policy if exists invites_lecture on public.joueurs_invites;
create policy invites_lecture on public.joueurs_invites for select to authenticated using (public.is_active_member());
drop policy if exists invites_admin on public.joueurs_invites;
create policy invites_admin on public.joueurs_invites for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Enregistre (ou rafraîchit) un invité
create or replace function public.noter_invite(p_nom text, p_team uuid default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  n text := regexp_replace(btrim(coalesce(p_nom, '')), '\s+', ' ', 'g');
begin
  if char_length(n) < 2 or char_length(n) > 40 then return; end if;
  -- Un membre actif porte déjà ce nom : rien à enregistrer
  if exists (select 1 from public.profiles p where p.status = 'active'
             and public.cle_nom(n) in (public.cle_nom(p.first_name || ' ' || p.last_name), public.cle_nom(p.nickname))) then
    return;
  end if;
  insert into public.joueurs_invites (nom, cle, team_id) values (n, public.cle_nom(n), p_team)
  on conflict (cle) do update set nb_utilisations = public.joueurs_invites.nb_utilisations + 1,
    utilise_le = now(), team_id = coalesce(excluded.team_id, public.joueurs_invites.team_id);
end;
$$;
revoke execute on function public.noter_invite(text, uuid) from public, anon, authenticated;

-- Captures automatiques ------------------------------------------------
create or replace function public.capter_invite_partie()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.profile_id is null and new.guest_name is not null then
    perform public.noter_invite(new.guest_name, null);
  end if;
  return new;
end;
$$;
drop trigger if exists invites_partie on public.game_players;
create trigger invites_partie after insert on public.game_players
  for each row execute function public.capter_invite_partie();

create or replace function public.capter_invite_tournoi()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.guest_name is not null and (tg_op = 'INSERT' or new.guest_name is distinct from old.guest_name) then
    perform public.noter_invite(new.guest_name, null);
  end if;
  if new.partner_guest_name is not null and (tg_op = 'INSERT' or new.partner_guest_name is distinct from old.partner_guest_name) then
    perform public.noter_invite(new.partner_guest_name, null);
  end if;
  return new;
end;
$$;
drop trigger if exists invites_tournoi on public.tournament_entries;
create trigger invites_tournoi after insert or update of guest_name, partner_guest_name on public.tournament_entries
  for each row execute function public.capter_invite_tournoi();

-- Feuille CPARD : seulement les joueurs de NOTRE équipe saisis à la main
create or replace function public.capter_invite_feuille()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c jsonb := case when new.notre_camp = 'A' then new.compo_a else new.compo_e end;
  ancien jsonb := case when tg_op = 'UPDATE' then (case when old.notre_camp = 'A' then old.compo_a else old.compo_e end) end;
  j record;
begin
  if c is distinct from ancien then
    for j in select value from jsonb_each(c) where jsonb_typeof(value) = 'object'
               and nullif(value ->> 'p', '') is null and nullif(btrim(value ->> 'n'), '') is not null loop
      perform public.noter_invite(j.value ->> 'n', new.team_id);
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists invites_feuille on public.feuilles_match;
create trigger invites_feuille after insert or update of compo_a, compo_e on public.feuilles_match
  for each row execute function public.capter_invite_feuille();

-- Reprise de l'existant -------------------------------------------------
do $$
declare
  r record;
begin
  for r in select guest_name n, null::uuid t from public.game_players where profile_id is null and guest_name is not null
           union all select guest_name, null from public.tournament_entries where guest_name is not null
           union all select partner_guest_name, null from public.tournament_entries where partner_guest_name is not null
           union all select j.value ->> 'n', f.team_id from public.feuilles_match f,
             jsonb_each(case when f.notre_camp = 'A' then f.compo_a else f.compo_e end) j
             where jsonb_typeof(j.value) = 'object' and nullif(j.value ->> 'p', '') is null and nullif(btrim(j.value ->> 'n'), '') is not null
  loop
    perform public.noter_invite(r.n, r.t);
  end loop;
end $$;

grant select on public.joueurs_invites to authenticated;
grant update, delete on public.joueurs_invites to authenticated;
notify pgrst, 'reload schema';
