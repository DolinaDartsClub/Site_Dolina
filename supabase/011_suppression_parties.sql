-- =====================================================================
--  Parties abandonnées : suppression définitive (15/10/2026)
--  À exécuter une fois dans Supabase : SQL Editor > New query > Run
--
--  Une partie abandonnée (ou interrompue depuis plus de 24 h) n'est plus
--  conservée : elle est supprimée avec ses joueurs et ses volées.
--  Une partie terminée ne peut être supprimée que par un admin.
-- =====================================================================

drop policy if exists games_delete on public.games;
create policy games_delete on public.games for delete to authenticated
  using (
    public.is_admin()
    or (created_by = auth.uid() and status <> 'finished' and public.is_active_member())
  );

-- Nettoyage de l'existant : parties abandonnées et parties interrompues depuis plus de 24 h
delete from public.games where status = 'abandoned';
delete from public.games where status = 'live' and created_at < now() - interval '24 hours';
