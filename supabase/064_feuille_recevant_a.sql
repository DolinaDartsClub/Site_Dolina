-- =====================================================================
--  064 · Feuille de match : l'équipe qui reçoit est toujours l'équipe A
--  Le camp n'est plus à choisir : à domicile nous sommes A (à gauche),
--  à l'extérieur nous sommes E.
--  Les feuilles déjà ouvertes et pas encore lancées sont corrigées
--  (compositions et remplacements échangés avec le camp).
--  À exécuter après le script 063.
-- =====================================================================

alter table public.feuilles_match alter column notre_camp set default 'A';

create or replace function public.creer_feuille(p_rencontre uuid, p_notre_camp text default 'E', p_cibles int default 2)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare
  r public.rencontres;
  id_f uuid;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  select * into r from public.rencontres where id = p_rencontre;
  if not found then
    raise exception 'Cette rencontre n''existe pas.';
  end if;
  if not public.feuille_peut_gerer(r.team_id) then
    raise exception 'Seuls le capitaine, le vice-capitaine de l''équipe et les admins peuvent ouvrir la feuille de match.';
  end if;
  select id into id_f from public.feuilles_match where rencontre_id = r.id;
  if found then
    return id_f;                     -- déjà ouverte : on la rouvre
  end if;
  loop
    select string_agg(substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1), '') into c
    from generate_series(1, 10);
    exit when not exists (select 1 from public.feuilles_match where code = c);
  end loop;
  insert into public.feuilles_match (rencontre_id, team_id, notre_camp, code, cibles)
  -- 064 : l'équipe qui reçoit est toujours l'équipe A (à gauche) ; p_notre_camp n'est plus utilisé
  values (r.id, r.team_id, case when r.domicile then 'A' else 'E' end, c, least(greatest(coalesce(p_cibles, 2), 1), 8))
  returning id into id_f;
  insert into public.feuille_matchs (feuille_id, numero) select id_f, n from generate_series(1, 20) n;
  return id_f;
end;
$$;

-- Feuilles pas encore lancées avec le mauvais camp : on échange A et E
-- (les postes A, B, C, D, Y, A1, A2 deviennent E, F, G, H, Z, E1, E2 et inversement)
create or replace function pg_temp.camp_inverse(c jsonb)
returns jsonb language plpgsql as $$
declare
  de text[] := array['A','B','C','D','Y','A1','A2','E','F','G','H','Z','E1','E2'];
  vers text[] := array['E','F','G','H','Z','E1','E2','A','B','C','D','Y','A1','A2'];
  res jsonb := '{}'::jsonb;
  k text; v jsonb; i int;
begin
  if c is null then return null; end if;
  for k, v in select * from jsonb_each(c) loop
    i := array_position(de, k);
    if i is null then continue; end if;
    if jsonb_typeof(v) = 'array' then
      v := (select coalesce(jsonb_agg(vers[array_position(de, x)] order by o), '[]'::jsonb)
            from jsonb_array_elements_text(v) with ordinality t(x, o) where array_position(de, x) is not null);
    end if;
    res := res || jsonb_build_object(vers[i], v);
  end loop;
  return res;
end;
$$;
update public.feuilles_match f set
  notre_camp = case when r.domicile then 'A' else 'E' end,
  compo_a = pg_temp.camp_inverse(f.compo_e), compo_e = pg_temp.camp_inverse(f.compo_a),
  rempl_a = case when f.rempl_e is null then null else jsonb_build_object('joueur', chr(ascii(f.rempl_e ->> 'joueur') - 4), 'apres', f.rempl_e -> 'apres') end,
  rempl_e = case when f.rempl_a is null then null else jsonb_build_object('joueur', chr(ascii(f.rempl_a ->> 'joueur') + 4), 'apres', f.rempl_a -> 'apres') end,
  updated_at = now()
from public.rencontres r
where r.id = f.rencontre_id and f.lancee_le is null and f.statut = 'composition'
  and f.notre_camp <> case when r.domicile then 'A' else 'E' end;
