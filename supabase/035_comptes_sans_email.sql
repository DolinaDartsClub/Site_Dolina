-- =====================================================================
--  035 – Comptes sans email (membres qui n'utilisent pas leur messagerie)
--  L'admin crée le compte depuis l'espace admin, au cas par cas :
--  - « identifiant » : le membre se connecte avec un identifiant
--    (ex. jean.dupont) et un code que l'admin lui donne ;
--  - « gere » : profil géré, sans connexion ; ses parties sont saisies
--    par un autre joueur qui le choisit dans la liste des membres.
--  Supabase exige un email : le compte reçoit une adresse interne
--    <identifiant>@identifiant.dolina.invalid
--  qui ne reçoit jamais rien (.invalid est réservé, il n'existe pas).
--  Code oublié : l'admin en choisit un nouveau (pas d'email possible).
--  Aucune clé secrète dans le site : tout passe par ces fonctions,
--  réservées aux admins.
--  NB : ces fonctions écrivent directement dans les tables de comptes de
--  Supabase (auth.users, auth.identities), comme le script 004.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 034.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.profiles add column if not exists compte text not null default 'email';
alter table public.profiles drop constraint if exists profiles_compte;
alter table public.profiles add constraint profiles_compte check (compte in ('email', 'identifiant', 'gere'));

-- Identifiant : minuscules, chiffres, point ou tiret (3 à 30 caractères)
create or replace function public.identifiant_valide(p text)
returns boolean language sql immutable as $$
  select p ~ '^[a-z0-9][a-z0-9.-]{1,28}[a-z0-9]$' and p !~ '\.\.';
$$;

create or replace function public.admin_creer_membre(
  p_prenom text,
  p_nom text,
  p_surnom text,
  p_identifiant text,
  p_code text,           -- null = profil géré (sans connexion)
  p_equipes uuid[] default '{}'
)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  uid uuid := gen_random_uuid();
  ident text := lower(trim(coalesce(p_identifiant, '')));
  mail text;
  code text := p_code;
  gere boolean := p_code is null or p_code = '';
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;
  if coalesce(trim(p_prenom), '') = '' or coalesce(trim(p_nom), '') = '' then
    raise exception 'Indiquez le prénom et le nom.';
  end if;
  if not public.identifiant_valide(ident) then
    raise exception 'Identifiant invalide : 3 à 30 caractères, lettres minuscules, chiffres, point ou tiret (ex. jean.dupont).';
  end if;
  mail := ident || '@identifiant.dolina.invalid';
  if exists (select 1 from auth.users where lower(email) = mail) then
    raise exception 'Cet identifiant est déjà pris : choisissez-en un autre.';
  end if;
  if gere then
    code := encode(gen_random_bytes(18), 'base64');   -- inconnu de tous : pas de connexion
  elsif char_length(code) < 6 or char_length(code) > 40 then
    raise exception 'Le code doit faire au moins 6 caractères.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', mail,
          crypt(code, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}'::jsonb,
          jsonb_build_object('first_name', trim(p_prenom), 'last_name', trim(p_nom), 'nickname', nullif(trim(coalesce(p_surnom, '')), '')),
          now(), now(), '', '', '', '');

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), uid, uid::text,
          jsonb_build_object('sub', uid::text, 'email', mail, 'email_verified', true),
          'email', now(), now(), now());

  -- Le profil a été créé par handle_new_user : compte validé directement
  update public.profiles
     set status = 'active', compte = case when gere then 'gere' else 'identifiant' end
   where id = uid;

  if coalesce(array_length(p_equipes, 1), 0) > 0 then
    insert into public.team_members (team_id, profile_id, status)
    select t.id, uid, 'accepted' from public.teams t where t.id = any (p_equipes)
    on conflict do nothing;
  end if;

  return json_build_object('id', uid, 'identifiant', ident, 'compte', case when gere then 'gere' else 'identifiant' end);
end;
$$;

-- Nouveau code pour un compte sans email (code oublié, ou profil géré qui
-- reçoit enfin un accès). Ne touche jamais aux comptes avec un vrai email.
create or replace function public.admin_changer_code(p_user uuid, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  mail text;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;
  if p_code is null or char_length(p_code) < 6 or char_length(p_code) > 40 then
    raise exception 'Le code doit faire au moins 6 caractères.';
  end if;
  select email into mail from auth.users where id = p_user;
  if mail is null or mail not like '%@identifiant.dolina.invalid' then
    raise exception 'Ce membre a un vrai email : il change son mot de passe avec « Mot de passe oublié ».';
  end if;
  update auth.users set encrypted_password = crypt(p_code, gen_salt('bf')), updated_at = now() where id = p_user;
  update public.profiles set compte = 'identifiant' where id = p_user;
  return json_build_object('identifiant', split_part(mail, '@', 1));
end;
$$;

-- Un membre qui ajoute plus tard un vrai email redevient un compte classique
create or replace function public.compte_suivre_email()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email and new.email not like '%@identifiant.dolina.invalid' then
    update public.profiles set compte = 'email' where id = new.id and compte <> 'email';
    update public.profile_private set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists compte_suivre_email on auth.users;
create trigger compte_suivre_email after update of email on auth.users
  for each row execute function public.compte_suivre_email();

revoke execute on function public.admin_creer_membre(text, text, text, text, text, uuid[]) from public, anon;
revoke execute on function public.admin_changer_code(uuid, text) from public, anon;
grant execute on function public.admin_creer_membre(text, text, text, text, text, uuid[]) to authenticated;
grant execute on function public.admin_changer_code(uuid, text) to authenticated;
