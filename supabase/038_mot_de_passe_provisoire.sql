-- =====================================================================
--  038 – Mot de passe oublié (solution provisoire, sans envoi d'email)
--  1. Le membre remplit « Mot de passe oublié » : une demande arrive dans
--     Espace admin › Demandes (motif « Mot de passe oublié »), avec sa
--     façon préférée d'être recontacté (appel, SMS, WhatsApp, email).
--  2. L'admin ouvre la fiche du membre et clique « Mot de passe provisoire » :
--     le site tire un code, à transmettre au membre.
--  3. À sa connexion, le membre est invité à choisir son propre mot de passe
--     dans « Mon compte » (le provisoire disparaît une fois changé).
--  Un admin ne peut pas changer le mot de passe d'un autre admin (script 004).
--  À exécuter une fois dans Supabase (SQL Editor), après le script 037.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.profiles add column if not exists mdp_provisoire boolean not null default false;

alter table public.contact_requests drop constraint if exists contact_requests_motif_check;
alter table public.contact_requests add constraint contact_requests_motif_check
  check (motif in ('adhesion', 'question', 'autre', 'mot_de_passe'));

create or replace function public.envoyer_demande_contact_v2(
  p_motif text, p_prenom text, p_nom text, p_telephone text, p_email text, p_message text, p_pref text, p_moment text default ''
)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  e text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  t text := nullif(btrim(coalesce(p_telephone, '')), '');
begin
  if coalesce(p_motif, '') not in ('adhesion', 'question', 'autre', 'mot_de_passe') then
    raise exception 'Choisissez l''objet de votre demande.';
  end if;
  if coalesce(p_pref, '') not in ('appel', 'sms', 'whatsapp', 'email') then
    raise exception 'Choisissez comment vous préférez être contacté.';
  end if;
  if coalesce(p_moment, '') not in ('', 'matin', 'midi', 'apres-midi', 'soir', 'week-end') then
    raise exception 'Moment de contact inconnu.';
  end if;
  if char_length(btrim(coalesce(p_prenom, ''))) = 0 or char_length(btrim(coalesce(p_nom, ''))) = 0 then
    raise exception 'Indiquez votre prénom et votre nom.';
  end if;
  if t is not null and char_length(regexp_replace(t, '[^0-9]', '', 'g')) < 6 then
    raise exception 'Indiquez un numéro de téléphone valide.';
  end if;
  if p_pref <> 'email' and t is null then
    raise exception 'Indiquez votre numéro de téléphone pour être rappelé ou recevoir un message.';
  end if;
  if e is not null and e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Indiquez une adresse email valide.';
  end if;
  if p_pref = 'email' and e is null then
    raise exception 'Indiquez votre adresse email pour recevoir notre réponse.';
  end if;
  if char_length(coalesce(p_message, '')) > 2000 then
    raise exception 'Votre message est trop long (2000 caractères au maximum).';
  end if;
  -- Limites : 3 demandes par personne et par jour, 30 demandes par heure au total
  if (select count(*) from public.contact_requests
      where created_at > now() - interval '1 day'
        and ((e is not null and email = e) or (t is not null and regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace(t, '[^0-9]', '', 'g')))) >= 3 then
    raise exception 'Vous avez déjà envoyé plusieurs demandes aujourd''hui. Le club vous répondra au plus vite.';
  end if;
  if (select count(*) from public.contact_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de demandes en ce moment. Réessayez un peu plus tard.';
  end if;
  insert into public.contact_requests (motif, first_name, last_name, phone, email, message, contact_pref, moment)
  values (p_motif, left(btrim(p_prenom), 60), left(btrim(p_nom), 60), left(t, 30), e, coalesce(btrim(p_message), ''), p_pref, coalesce(p_moment, ''));
end;
$$;

grant execute on function public.envoyer_demande_contact_v2(text, text, text, text, text, text, text, text) to anon, authenticated;

-- Mot de passe provisoire choisi par un admin (tous les comptes, sauf ceux des autres admins)
create or replace function public.admin_mot_de_passe_provisoire(p_user uuid, p_code text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  cible public.profiles;
  mail text;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;
  if p_code is null or char_length(p_code) < 6 or char_length(p_code) > 40 then
    raise exception 'Le mot de passe provisoire doit faire au moins 6 caractères.';
  end if;
  select * into cible from public.profiles where id = p_user;
  if cible.id is null then
    raise exception 'Membre introuvable.';
  end if;
  if cible.role = 'admin' and cible.id <> auth.uid() then
    raise exception 'Le mot de passe d''un autre admin se change avec le script SQL 004.';
  end if;
  select email into mail from auth.users where id = p_user;
  update auth.users set encrypted_password = crypt(p_code, gen_salt('bf')), updated_at = now() where id = p_user;
  update public.profiles
     set mdp_provisoire = true,
         compte = case when compte = 'gere' then 'identifiant' else compte end   -- un profil géré reçoit un accès
   where id = p_user;
  return json_build_object(
    'connexion', case when mail like '%@identifiant.dolina.invalid' then split_part(mail, '@', 1) else mail end,
    'identifiant', mail like '%@identifiant.dolina.invalid');
end;
$$;
revoke execute on function public.admin_mot_de_passe_provisoire(uuid, text) from public, anon;
grant execute on function public.admin_mot_de_passe_provisoire(uuid, text) to authenticated;

-- Le membre a choisi son propre mot de passe : le bandeau « provisoire » disparaît
create or replace function public.mot_de_passe_change()
returns void language sql security definer set search_path = public as $$
  update public.profiles set mdp_provisoire = false where id = auth.uid();
$$;
revoke execute on function public.mot_de_passe_change() from public, anon;
grant execute on function public.mot_de_passe_change() to authenticated;

notify pgrst, 'reload schema';
