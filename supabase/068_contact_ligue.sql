-- =====================================================================
--  068 · Ligue interne : contacter son adversaire sur WhatsApp
--  Le téléphone d'un membre reste privé (lui et les admins) SAUF s'il
--  accepte de le partager avec ses adversaires de ligue (case dans
--  « Mon compte » ou dans « Mes matchs »). Un joueur ne reçoit que le
--  numéro des adversaires contre qui il a un match dans la même ligue.
--  À exécuter après le script 067.
-- =====================================================================

alter table public.profile_private add column if not exists partage_tel_ligue boolean not null default false;

create or replace function public.contacts_ligue(p_tournoi uuid)
returns table (entry_id uuid, telephone text)
language sql stable security definer set search_path = public as $$
  with moi as (
    select e.id from public.tournament_entries e
    join public.tournaments t on t.id = e.tournament_id and t.est_ligue
    where e.tournament_id = p_tournoi and e.profile_id = auth.uid()
  ),
  adv as (
    select distinct case when m.entry_a = moi.id then m.entry_b else m.entry_a end as entry_id
    from public.tournament_matches m, moi
    where m.tournament_id = p_tournoi and (m.entry_a = moi.id or m.entry_b = moi.id)
  )
  select a.entry_id, pp.phone
  from adv a
  join public.tournament_entries e on e.id = a.entry_id
  join public.profile_private pp on pp.id = e.profile_id
  where pp.partage_tel_ligue and btrim(pp.phone) <> '' and public.is_active_member();
$$;
grant execute on function public.contacts_ligue(uuid) to authenticated;
