-- =====================================================================
--  078 – Feuille CPARD : tout le monde peut scorer
--  - Avec le lien du capitaine adverse (sans compte) : saisie du score
--    des matchs (2-0, 2-1…), une fois la rencontre lancée.
--  - Tout membre du club connecté (même hors de l'équipe) : saisie du
--    score ou scorer complet.
--  Corriger un match déjà saisi reste réservé au capitaine qui gère.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 077.
--  Peut être relancé sans risque.
-- =====================================================================

create or replace function public.feuille_verifier_jouable(f public.feuilles_match, m public.feuille_matchs)
returns void language plpgsql stable set search_path = public as $$
declare
  manque text;
begin
  -- 078 : l'équipe, tout membre du club connecté, ou quiconque a le lien du capitaine adverse
  if not (public.feuille_peut_jouer(f.team_id) or public.is_active_member()
          or coalesce(current_setting('dolina.code_feuille', true), '') = f.code) then
    raise exception 'Seuls les membres du club et les personnes qui ont le lien de la feuille peuvent saisir les matchs.';
  end if;
  if f.statut = 'validee' then
    raise exception 'La feuille est validée : elle ne se modifie plus.';
  end if;
  if f.lancee_le is null then
    raise exception 'La rencontre n''est pas encore lancée : le capitaine qui reçoit la lance une fois les deux équipes saisies.';
  end if;
  manque := coalesce('équipe A : ' || public.feuille_compo_manque(f.compo_a, 'A'), 'équipe E : ' || public.feuille_compo_manque(f.compo_e, 'E'));
  if manque is not null then
    raise exception 'Composition incomplète (%) : complétez-la avant de jouer.', manque;
  end if;
end;
$$;

-- Saisie du score par le lien de la feuille (sans compte)
create or replace function public.saisir_resultat_feuille_code(p_code text, p_numero int, p_manches_a int, p_manches_e int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  fid uuid;
  cle text := upper(trim(coalesce(p_code, '')));
begin
  select id into fid from public.feuilles_match where code = cle;
  if fid is null then
    raise exception 'Ce lien de feuille de match n''est pas valide.';
  end if;
  perform set_config('dolina.code_feuille', cle, true);
  perform public.saisir_resultat_feuille(fid, p_numero, p_manches_a, p_manches_e);
  perform set_config('dolina.code_feuille', '', true);
end;
$$;

grant execute on function public.saisir_resultat_feuille_code(text, int, int, int) to anon, authenticated;
notify pgrst, 'reload schema';
