-- =====================================================================
--  046 – Parties contre le dartbot : toujours privées
--  À partir de maintenant, une partie contre le dartbot est enregistrée
--  en privé, même si on demande « publique ». Elle n'apparaît plus dans
--  « Matchs en cours » ni dans « Derniers matchs » de l'accueil.
--  Les anciennes parties ne sont pas modifiées.
--  À exécuter une fois dans Supabase (SQL Editor), après le script 045.
--  Peut être relancé sans risque.
-- =====================================================================

create or replace function public.partie_bot_privee()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.mode = 'bot' then
    new.visibility := 'private';
  end if;
  return new;
end;
$$;

drop trigger if exists partie_bot_privee on public.games;
create trigger partie_bot_privee before insert on public.games
  for each row execute function public.partie_bot_privee();

notify pgrst, 'reload schema';
