-- =====================================================================
--  033 – « Nous contacter » : le visiteur choisit comment être recontacté
--  (appel, SMS, WhatsApp ou email) et, s'il veut, le meilleur moment.
--  Seule la coordonnée utile à ce choix est obligatoire : le téléphone
--  pour un appel, un SMS ou WhatsApp ; l'email pour un email.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 032.
-- =====================================================================

alter table public.contact_requests add column if not exists contact_pref text not null default 'email';
alter table public.contact_requests add column if not exists moment text not null default '';
alter table public.contact_requests drop constraint if exists contact_requests_contact_pref_check;
alter table public.contact_requests add constraint contact_requests_contact_pref_check check (contact_pref in ('appel', 'sms', 'whatsapp', 'email'));
alter table public.contact_requests drop constraint if exists contact_requests_moment_check;
alter table public.contact_requests add constraint contact_requests_moment_check check (moment in ('', 'matin', 'midi', 'apres-midi', 'soir', 'week-end'));

-- Téléphone et email deviennent facultatifs (selon le moyen choisi)
alter table public.contact_requests alter column phone drop not null;
alter table public.contact_requests alter column email drop not null;
alter table public.contact_requests drop constraint if exists contact_requests_phone_check;
alter table public.contact_requests add constraint contact_requests_phone_check check (phone is null or char_length(btrim(phone)) between 6 and 30);
alter table public.contact_requests drop constraint if exists contact_requests_email_check;
alter table public.contact_requests add constraint contact_requests_email_check check (email is null or (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 160));
alter table public.contact_requests drop constraint if exists contact_requests_coordonnee;
alter table public.contact_requests add constraint contact_requests_coordonnee check (phone is not null or email is not null);

create or replace function public.envoyer_demande_contact_v2(
  p_motif text, p_prenom text, p_nom text, p_telephone text, p_email text, p_message text, p_pref text, p_moment text default ''
)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  e text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  t text := nullif(btrim(coalesce(p_telephone, '')), '');
begin
  if coalesce(p_motif, '') not in ('adhesion', 'question', 'autre') then
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

notify pgrst, 'reload schema';
