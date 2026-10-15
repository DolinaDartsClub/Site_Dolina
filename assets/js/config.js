// =====================================================================
//  Configuration publique du site.
//  Ces deux valeurs sont faites pour être visibles dans le navigateur :
//  la sécurité repose sur les règles d'accès de la base (RLS).
//  NE JAMAIS mettre ici la clé « secret » / « service_role ».
// =====================================================================

export const SUPABASE_URL = 'https://zygebzwobnxutowiqgxk.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_ZIj8arAEEmcIgp3EguWCzw_Uxc2szqz';

// Passer à true quand l'envoi d'emails fonctionne (domaine du club + Brevo, ou Gmail).
// Tant que c'est false, « Mot de passe oublié » invite à contacter le club.
export const EMAILS_ACTIFS = false;

// Adresse de contact du club
export const EMAIL_CLUB = 'dolinadartsclub@gmail.com';
