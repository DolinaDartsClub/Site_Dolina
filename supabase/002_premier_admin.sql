-- =====================================================================
--  Désigner le premier administrateur (à faire une seule fois)
--
--  1. Créez d'abord votre compte joueur via le formulaire d'inscription du site.
--  2. Remplacez l'adresse ci-dessous par l'email utilisé pour ce compte.
--  3. Collez ce script dans Supabase › SQL Editor, puis « Run ».
--
--  Ensuite, les autres admins se désignent depuis l'administration du site.
-- =====================================================================

update public.profiles
   set status = 'active', role = 'admin'
 where id = (select id from auth.users where email = 'VOTRE.EMAIL@exemple.fr');

-- Vérification : doit afficher une ligne avec role = admin
select p.first_name, p.last_name, p.role, p.status
  from public.profiles p
  join auth.users u on u.id = p.id
 where u.email = 'VOTRE.EMAIL@exemple.fr';
