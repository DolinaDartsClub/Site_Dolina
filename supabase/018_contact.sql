-- =====================================================================
--  Rubrique « Nous contacter » : demandes enregistrées sur le site
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--
--  Les visiteurs envoient une demande (rejoindre le club, question…).
--  Elle est rangée dans la table contact_requests, visible seulement
--  par les admins (onglet « Demandes » de l'administration).
--  Plus tard, quand l'envoi d'emails sera actif, un email pourra être
--  envoyé automatiquement à chaque nouvelle demande, sans rien changer ici.
-- =====================================================================

create table if not exists public.contact_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  motif       text not null check (motif in ('adhesion', 'question', 'autre')),
  first_name  text not null check (char_length(btrim(first_name)) between 1 and 60),
  last_name   text not null check (char_length(btrim(last_name)) between 1 and 60),
  phone       text not null check (char_length(btrim(phone)) between 6 and 30),
  email       text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 160),
  message     text not null default '' check (char_length(message) <= 2000),
  status      text not null default 'new' check (status in ('new', 'done')),
  treated_at  timestamptz,
  treated_by  uuid references public.profiles (id) on delete set null,
  note        text not null default '' check (char_length(note) <= 1000)
);

create index if not exists contact_requests_recent on public.contact_requests (status, created_at desc);

alter table public.contact_requests enable row level security;

-- Lecture, suivi et suppression : admins uniquement. Aucun ajout direct :
-- les visiteurs passent par la fonction envoyer_demande_contact.
drop policy if exists contact_admin_lecture on public.contact_requests;
create policy contact_admin_lecture on public.contact_requests for select to authenticated using (public.is_admin());
drop policy if exists contact_admin_suivi on public.contact_requests;
create policy contact_admin_suivi on public.contact_requests for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists contact_admin_suppression on public.contact_requests;
create policy contact_admin_suppression on public.contact_requests for delete to authenticated using (public.is_admin());

-- Envoi d'une demande (visiteurs compris), avec une limite contre les abus
create or replace function public.envoyer_demande_contact(
  p_motif text, p_prenom text, p_nom text, p_telephone text, p_email text, p_message text
)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  e text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_motif, '') not in ('adhesion', 'question', 'autre') then
    raise exception 'Choisissez l''objet de votre demande.';
  end if;
  if char_length(btrim(coalesce(p_prenom, ''))) = 0 or char_length(btrim(coalesce(p_nom, ''))) = 0 then
    raise exception 'Indiquez votre prénom et votre nom.';
  end if;
  if char_length(regexp_replace(coalesce(p_telephone, ''), '[^0-9]', '', 'g')) < 6 then
    raise exception 'Indiquez un numéro de téléphone valide.';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Indiquez une adresse email valide.';
  end if;
  if char_length(coalesce(p_message, '')) > 2000 then
    raise exception 'Votre message est trop long (2000 caractères au maximum).';
  end if;
  -- Limites : 3 demandes par email et par jour, 30 demandes par heure au total
  if (select count(*) from public.contact_requests where email = e and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Vous avez déjà envoyé plusieurs demandes aujourd''hui. Le club vous répondra au plus vite.';
  end if;
  if (select count(*) from public.contact_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Trop de demandes en ce moment. Réessayez un peu plus tard.';
  end if;
  insert into public.contact_requests (motif, first_name, last_name, phone, email, message)
  values (p_motif, left(btrim(p_prenom), 60), left(btrim(p_nom), 60), left(btrim(p_telephone), 30), e, coalesce(btrim(p_message), ''));
end;
$$;

grant execute on function public.envoyer_demande_contact(text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
