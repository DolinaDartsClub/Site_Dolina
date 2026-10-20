-- =====================================================================
--  040 – Jeux du club : parties en cours reprenables sur un autre appareil
--  Une partie de Pentadarts ou de Capital est enregistrée dès le début
--  (statut « live ») et mise à jour à chaque volée : on peut la lancer sur
--  l'ordinateur et la reprendre sur le téléphone. À la fin : « finished ».
--  Mise à jour : le créateur ou un joueur de la partie (avec son compte),
--  tant qu'elle est en cours. Abandon (suppression) : idem, ou un admin.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 039.
--  Peut être relancé sans risque.
-- =====================================================================

alter table public.jeux_parties add column if not exists statut text not null default 'finished';
alter table public.jeux_parties drop constraint if exists jeux_parties_statut;
alter table public.jeux_parties add constraint jeux_parties_statut check (statut in ('live', 'finished'));
alter table public.jeux_parties add column if not exists updated_at timestamptz not null default now();
alter table public.jeux_parties alter column resultat set default '{}'::jsonb;
create index if not exists jeux_parties_en_cours on public.jeux_parties (statut, updated_at desc);

-- Le créateur ou un joueur de la partie (avec son compte)
create or replace function public.joue_ou_cree(p_joueurs jsonb, p_createur uuid)
returns boolean language sql stable as $$
  select p_createur = auth.uid() or coalesce(p_joueurs @> jsonb_build_array(jsonb_build_object('profile_id', auth.uid())), false);
$$;

create or replace function public.jeux_parties_maj()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;   -- le créateur ne change pas
  return new;
end;
$$;
drop trigger if exists jeux_parties_maj on public.jeux_parties;
create trigger jeux_parties_maj before update on public.jeux_parties
  for each row execute function public.jeux_parties_maj();

drop policy if exists jeux_parties_update on public.jeux_parties;
create policy jeux_parties_update on public.jeux_parties for update to authenticated
  using (statut = 'live' and public.is_active_member() and public.joue_ou_cree(joueurs, created_by))
  with check (public.is_active_member() and public.joue_ou_cree(joueurs, created_by));

drop policy if exists jeux_parties_delete on public.jeux_parties;
create policy jeux_parties_delete on public.jeux_parties for delete to authenticated
  using (public.is_admin() or created_by = auth.uid()
         or (statut = 'live' and public.joue_ou_cree(joueurs, created_by)));
