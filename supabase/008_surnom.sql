-- =====================================================================
--  Surnom affiché sur le site (à coller dans Supabase › SQL Editor, puis « Run »)
--
--  Si le joueur coche « Utiliser mon surnom sur le site », c'est son surnom
--  qui apparaît dans les matchs, le score en direct et les classements.
--  Son nom complet reste visible sur sa fiche.
-- =====================================================================

alter table public.profiles
  add column if not exists use_nickname boolean not null default false;

-- Nom affiché d'un joueur : son surnom s'il l'a choisi, sinon « Prénom Nom »
create or replace function public.nom_affiche(p public.profiles)
returns text language sql immutable as $$
  select case
    when p.use_nickname and nullif(trim(p.nickname), '') is not null then trim(p.nickname)
    else p.first_name || ' ' || p.last_name
  end;
$$;

-- Les joueurs ajoutés à une partie prennent ce nom affiché
create or replace function public.set_player_display_name()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Compte supprimé : le joueur devient « Ancien joueur »
  if tg_op = 'UPDATE' and new.profile_id is null and old.profile_id is not null and new.guest_name is null then
    new.display_name := 'Ancien joueur';
    return new;
  end if;
  if new.profile_id is not null then
    select public.nom_affiche(p) into new.display_name
    from public.profiles p where p.id = new.profile_id;
    new.guest_name := null;
  elsif new.guest_name is not null then
    new.display_name := new.guest_name;
  elsif exists (select 1 from public.game_sides s where s.game_id = new.game_id and s.side = new.side and s.is_bot) then
    new.display_name := 'Dartbot';
  else
    raise exception 'Un joueur doit être un membre, un invité ou le dartbot.';
  end if;
  return new;
end;
$$;

-- Quand un joueur change de nom, de surnom ou de choix d'affichage,
-- ses parties (y compris passées) affichent le nouveau nom
create or replace function public.maj_noms_parties()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.nom_affiche(new) is distinct from public.nom_affiche(old) then
    update public.game_players set display_name = public.nom_affiche(new)
    where profile_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_maj_noms_parties on public.profiles;
create trigger profiles_maj_noms_parties
  after update of first_name, last_name, nickname, use_nickname on public.profiles
  for each row execute function public.maj_noms_parties();

-- Fin du script.
