-- =====================================================================
--  Sauvegarde des données du club et place utilisée
--  À exécuter une fois dans Supabase (après 023) : SQL Editor > New query > Run
--
--  Le plan gratuit de Supabase ne fait pas de sauvegarde automatique.
--  L'admin télécharge donc lui-même, depuis l'onglet « Sauvegarde » de
--  l'espace admin, un fichier contenant toutes les tables du site
--  (membres, coordonnées, équipes, actus, parties, volées, tournois,
--  demandes, réglages). Les fichiers images (photos, actus) ne sont pas
--  dans ce fichier : seuls leurs noms y figurent.
--  Réservé aux admins.
-- =====================================================================

-- Toutes les tables du schéma public, sous la forme { "table": [lignes…] }
create or replace function public.sauvegarde_club()
returns json language plpgsql volatile security definer set search_path = public as $$
declare
  t record;
  lignes jsonb;
  tables jsonb := '{}'::jsonb;
  nombres jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then
    raise exception 'La sauvegarde est réservée aux administrateurs.';
  end if;
  for t in select tablename from pg_tables where schemaname = 'public' and tablename not like '\_%' order by tablename loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from public.%I x', t.tablename) into lignes;
    tables := tables || jsonb_build_object(t.tablename, lignes);
    nombres := nombres || jsonb_build_object(t.tablename, jsonb_array_length(lignes));
  end loop;
  insert into public.settings (key, value) values ('last_backup_at', to_jsonb(now()))
    on conflict (key) do update set value = excluded.value;
  return json_build_object(
    'site', 'Dolina Darts Club',
    'format', 1,
    'date', now(),
    'par', auth.uid(),
    'nombres', nombres,
    'tables', tables
  );
end;
$$;

-- Place utilisée (base de données et fichiers) et date de la dernière sauvegarde
create or replace function public.espace_utilise()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  fichiers bigint;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs.';
  end if;
  begin
    execute 'select coalesce(sum((metadata ->> ''size'')::bigint), 0) from storage.objects' into fichiers;
  exception when others then
    fichiers := null;
  end;
  return json_build_object(
    'base', pg_database_size(current_database()),
    'fichiers', fichiers,
    'derniere_sauvegarde', (select value #>> '{}' from public.settings where key = 'last_backup_at')
  );
end;
$$;

revoke execute on function public.sauvegarde_club() from public, anon;
revoke execute on function public.espace_utilise() from public, anon;
grant execute on function public.sauvegarde_club() to authenticated;
grant execute on function public.espace_utilise() to authenticated;

notify pgrst, 'reload schema';
