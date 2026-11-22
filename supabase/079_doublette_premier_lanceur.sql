-- =====================================================================
--  079 · Doublettes (2v2) : chaque équipe choisit son premier lanceur
--
--  Avant la première volée de son équipe, on choisit lequel des deux
--  joueurs commence. Ce joueur commence ensuite TOUTES les manches
--  (le scorer alterne les joueurs à l'intérieur de chaque manche).
--
--  Qui peut choisir : celui qui tient le score (créateur de la partie,
--  admin), un joueur de l'équipe, ou quiconque a le lien de la feuille
--  CPARD (p_code). Bloqué dès que l'équipe a lancé sa première volée.
--  À exécuter après 078.
-- =====================================================================

create or replace function public.choisir_premier_lanceur(p_game uuid, p_side smallint, p_joueur uuid, p_code text default null)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  g public.games;
begin
  if nullif(trim(coalesce(p_code, '')), '') is not null then
    g := public.partie_du_lien(p_code, p_game);
  else
    select * into g from public.games where id = p_game;
    if g.id is null then raise exception 'Partie introuvable.'; end if;
    if not (public.can_edit_game(p_game)
            or exists (select 1 from public.game_players
                       where game_id = p_game and side = p_side and profile_id = auth.uid())) then
      raise exception 'Seule la personne qui tient le score ou un joueur de l''équipe peut choisir le premier lanceur.';
    end if;
  end if;
  if g.mode <> 'double' then raise exception 'Le premier lanceur se choisit seulement en double.'; end if;
  if g.status in ('finished', 'abandoned') then raise exception 'La partie est terminée.'; end if;
  if not exists (select 1 from public.game_players where game_id = p_game and side = p_side and id = p_joueur) then
    raise exception 'Ce joueur ne fait pas partie de cette équipe.';
  end if;
  if exists (select 1 from public.visits where game_id = p_game and side = p_side) then
    raise exception 'Cette équipe a déjà lancé : le premier lanceur ne peut plus changer.';
  end if;
  update public.game_players
     set throw_order = case when id = p_joueur then 1 else 2 end
   where game_id = p_game and side = p_side;
end;
$$;

revoke all on function public.choisir_premier_lanceur(uuid, smallint, uuid, text) from public;
grant execute on function public.choisir_premier_lanceur(uuid, smallint, uuid, text) to anon, authenticated;
