-- =====================================================================
--  Étape 5b : correction d'une partie terminée (créateur ou admin)
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
-- =====================================================================

-- Date de la dernière correction, affichée sur le résumé de la partie
alter table public.games add column if not exists corrected_at timestamptz;

-- Enregistre toutes les volées corrigées d'un coup (tout ou rien).
-- Les droits sont ceux de la personne connectée (règles RLS habituelles).
create or replace function public.corriger_partie(p_game uuid, p_volees jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v jsonb;
  n integer;
begin
  if not public.can_edit_game(p_game) then
    raise exception 'Seul le créateur de la partie ou un admin peut la corriger.';
  end if;
  if not exists (select 1 from public.games where id = p_game and status = 'finished') then
    raise exception 'Seule une partie terminée peut être corrigée.';
  end if;

  for v in select * from jsonb_array_elements(p_volees) loop
    update public.visits set
      score            = (v->>'score')::smallint,
      remaining_before = (v->>'remaining_before')::smallint,
      is_bust          = (v->>'is_bust')::boolean,
      is_checkout      = (v->>'is_checkout')::boolean,
      darts_used       = (v->>'darts_used')::smallint,
      darts_at_double  = (v->>'darts_at_double')::smallint
    where id = (v->>'id')::bigint and game_id = p_game;
    get diagnostics n = row_count;
    if n = 0 then
      raise exception 'Volée introuvable dans cette partie.';
    end if;
  end loop;

  update public.games set corrected_at = now() where id = p_game;
end;
$$;

grant execute on function public.corriger_partie(uuid, jsonb) to authenticated;
