-- =====================================================================
--  Réinitialiser le mot de passe d'un joueur (réservé aux admins)
--  Solution provisoire tant que l'envoi d'emails n'est pas en place.
--
--  1. Remplacez l'email du joueur et le mot de passe provisoire ci-dessous.
--  2. Collez dans Supabase › SQL Editor, puis « Run ».
--  3. Communiquez le mot de passe provisoire au joueur (en direct ou par SMS),
--     et demandez-lui de le changer aussitôt dans « Mon compte ».
-- =====================================================================

update auth.users
   set encrypted_password = extensions.crypt('MotDePasseProvisoire2026', extensions.gen_salt('bf')),
       updated_at = now()
 where email = 'email.du.joueur@exemple.fr';

-- Vérification : doit afficher « 1 » ligne mise à jour ci-dessus,
-- et le joueur doit apparaître ici
select email, updated_at from auth.users where email = 'email.du.joueur@exemple.fr';
