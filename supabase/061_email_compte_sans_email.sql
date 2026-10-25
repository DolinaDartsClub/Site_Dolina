-- =====================================================================
--  061 · Donner un email (et un téléphone) à un membre créé sans email
--  L'admin saisit l'email du membre : son compte devient un compte
--  classique (connexion avec l'email, « Mot de passe oublié » possible).
--  Son profil, ses parties, ses équipes et ses stats sont conservés.
--  L'ancien identifiant ne sert plus à se connecter.
--  À exécuter après le script 060.
-- =====================================================================

create or replace function public.admin_ajouter_email(p_user uuid, p_email text, p_phone text default null)
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  ancien text;
  mail text := lower(trim(coalesce(p_email, '')));
  tel text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;
  select email into ancien from auth.users where id = p_user;
  if ancien is null then
    raise exception 'Ce membre n''existe pas.';
  end if;
  if ancien not like '%@identifiant.dolina.invalid' then
    raise exception 'Ce membre a déjà un email : il le change lui-même depuis son compte.';
  end if;
  if mail !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' or mail like '%.invalid' then
    raise exception 'Adresse email invalide.';
  end if;
  if exists (select 1 from auth.users where lower(email) = mail and id <> p_user) then
    raise exception 'Cet email est déjà utilisé par un autre compte du site.';
  end if;
  if tel is not null and length(regexp_replace(tel, '[^0-9]', '', 'g')) < 9 then
    raise exception 'Numéro de téléphone invalide.';
  end if;

  update auth.users set email = mail, email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
  where id = p_user;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', mail, 'email_verified', true), updated_at = now()
  where user_id = p_user and provider = 'email';
  -- compte_suivre_email (script 035) passe le compte en « email » et met à jour profile_private.email
  update public.profiles set compte = 'email' where id = p_user;
  update public.profile_private set email = mail, phone = coalesce(tel, phone) where id = p_user;
  return json_build_object('email', mail, 'ancien_identifiant', split_part(ancien, '@', 1));
end;
$$;
revoke execute on function public.admin_ajouter_email(uuid, text, text) from public, anon;
grant execute on function public.admin_ajouter_email(uuid, text, text) to authenticated;
