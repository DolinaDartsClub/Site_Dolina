-- =====================================================================
--  Profil joueur : marque des fléchettes
--  (à coller dans Supabase › SQL Editor, puis « Run »)
-- =====================================================================

alter table public.profiles
  add column if not exists dart_brand text check (char_length(dart_brand) <= 40);

-- L'inscription enregistre aussi la marque, si elle est indiquée
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  w    text  := meta ->> 'dart_weight';
begin
  insert into public.profiles (id, first_name, last_name, nickname, hand, dart_weight, dart_brand, photo_consent)
  values (
    new.id,
    left(coalesce(nullif(trim(meta ->> 'first_name'), ''), '?'), 60),
    left(coalesce(nullif(trim(meta ->> 'last_name'),  ''), '?'), 60),
    left(nullif(trim(meta ->> 'nickname'), ''), 40),
    case when meta ->> 'hand' in ('droitier', 'gaucher') then meta ->> 'hand' end,
    case when w ~ '^[0-9]{1,2}(\.[0-9])?$' and w::numeric between 10 and 50 then w::numeric end,
    left(nullif(trim(meta ->> 'dart_brand'), ''), 40),
    coalesce((meta ->> 'photo_consent') = 'true', false)
  );

  insert into public.profile_private (id, email, phone)
  values (new.id, new.email, left(coalesce(trim(meta ->> 'phone'), ''), 30));

  if jsonb_typeof(meta -> 'teams') = 'array' then
    insert into public.team_members (team_id, profile_id)
    select t.id, new.id
    from public.teams t
    where t.id::text in (select jsonb_array_elements_text(meta -> 'teams'))
    on conflict do nothing;
  end if;

  return new;
end;
$$;

-- Fin du script.
