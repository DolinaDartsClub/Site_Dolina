-- =====================================================================
--  069 · Phase finale / Master : meilleur croisement avec 2 poules
--  Avant : têtes de série 1A, 1B, 2B, 2A, 3A, 3B… (serpentin). Avec 2 poules
--  et des exemptions (ex. 10 qualifiés dans un arbre de 16), des quarts de
--  finale opposaient forcément deux joueurs d'une même poule (2e A contre
--  3e A). Désormais, avec 2 poules : 1A, 1B, 2A, 2B, 3A, 3B… : chaque match
--  du tableau oppose des têtes de série de poules différentes.
--  À exécuter après le script 068.
-- =====================================================================

create or replace function public.lancer_phase_finale(p_tournoi uuid, p_format jsonb)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  t public.tournaments;
  f jsonb := public.verifier_format_match(p_format);
  qualif uuid[] := '{}';
  poules int[] := '{}';
  rangs int[] := '{}';
  r int; k int; i int; j int;
  n int; taille int := 2;
  ordre int[];
  sa int; sb int;
  tmp uuid; tmpi int;
  premier_no int;
  ok boolean;
begin
  select * into t from public.tournaments where id = p_tournoi for update;
  if not found or not public.tournoi_organisateur(p_tournoi) then
    raise exception 'Seul l''organisateur du tournoi (ou un admin) peut lancer la phase finale.';
  end if;
  if t.status <> 'running' or t.format <> 'pools' then
    raise exception 'La phase finale se lance pendant un tournoi avec poules.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'final') then
    raise exception 'La phase finale est déjà lancée.';
  end if;
  if exists (select 1 from public.tournament_matches where tournament_id = p_tournoi and phase = 'pool' and status not in ('done', 'bye')) then
    raise exception 'Tous les matchs de poule doivent être terminés avant la phase finale.';
  end if;

  -- Qualifiés, rang par rang : 1ers de chaque poule, puis 2es (ordre inversé), etc.
  for r in 1..t.pool_qualifiers loop
    for k in 1..t.pools_count loop
      -- 069 : avec 2 poules, toujours A puis B à chaque rang (1A, 1B, 2A, 2B…) : dans l'arbre, la tête
      -- de série s rencontre 2^n+1-s, de l'autre poule ; sinon ordre en serpentin (1A, 1B, 1C, 2C, 2B…)
      i := case when t.pools_count = 2 or r % 2 = 1 then k else t.pools_count + 1 - k end;
      select c.entry_id into tmp from public.classement_poule(p_tournoi, i) c where c.rang = r;
      if tmp is not null then
        qualif := qualif || tmp; poules := poules || i; rangs := rangs || r;
      end if;
    end loop;
  end loop;
  n := coalesce(array_length(qualif, 1), 0);
  if n < 2 then
    raise exception 'Il faut au moins 2 qualifiés pour la phase finale.';
  end if;

  -- Éviter, au premier tour, deux joueurs de la même poule (échanges entre joueurs de même rang)
  while taille < n loop taille := taille * 2; end loop;
  ordre := public.ordre_arbre(taille);
  for i in 1..taille / 2 loop
    sa := ordre[2 * i - 1]; sb := ordre[2 * i];
    continue when sa > n or sb > n or poules[sa] <> poules[sb];
    ok := false;
    for j in 1..n loop
      continue when j = sb or j = sa or rangs[j] <> rangs[sb];
      -- j prend la place de sb : vérifier que les deux matchs concernés deviennent valides
      declare
        adv_j int; pos int;
      begin
        adv_j := null;
        for pos in 1..taille loop
          if ordre[pos] = j then
            adv_j := case when pos % 2 = 1 then ordre[pos + 1] else ordre[pos - 1] end;
          end if;
        end loop;
        if poules[j] <> poules[sa] and (adv_j is null or adv_j > n or poules[sb] <> poules[adv_j]) then
          tmp := qualif[sb]; qualif[sb] := qualif[j]; qualif[j] := tmp;
          tmpi := poules[sb]; poules[sb] := poules[j]; poules[j] := tmpi;
          ok := true;
        end if;
      end;
      exit when ok;
    end loop;
  end loop;

  select coalesce(max(match_no), 0) + 1 into premier_no from public.tournament_matches where tournament_id = p_tournoi;
  perform set_config('dolina.interne', 'oui', true);
  perform public.creer_arbre(p_tournoi, qualif, premier_no, t.third_place);
  update public.tournaments set final_format = f where id = p_tournoi;
  perform public.verifier_fin_tournoi(p_tournoi);
end;
$$;
