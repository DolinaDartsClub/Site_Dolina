\pset tuples_only on
\pset format unaligned
select _t(null, 'visiteur : appel avec téléphone seul', $q$select envoyer_demande_contact_v2('adhesion','Léa','Durand','06 12 34 56 78','','Bonjour','appel','soir')::text$q$);
select _t(null, 'visiteur : email avec email seul', $q$select envoyer_demande_contact_v2('question','Max','Petit','','max@ex.fr','','email','')::text$q$);
select _t(null, 'WhatsApp sans téléphone : refusé', $q$select envoyer_demande_contact_v2('adhesion','A','B','','a@b.fr','','whatsapp','')::text$q$, 'numéro de téléphone');
select _t(null, 'email sans email : refusé', $q$select envoyer_demande_contact_v2('adhesion','A','B','0612345678','','','email','')::text$q$, 'adresse email');
select _t(null, 'moyen inconnu : refusé', $q$select envoyer_demande_contact_v2('adhesion','A','B','0612345678','','','pigeon','')::text$q$, 'Choisissez comment');
select _t(null, 'ancienne fonction toujours valable', $q$select envoyer_demande_contact('autre','Z','Y','0699999999','z@y.fr','')::text$q$);
select _t('11111111-1111-1111-1111-111111111111', 'admin : lit la préférence', $q$select string_agg(first_name || '=' || contact_pref || '/' || coalesce(phone,'-') || '/' || coalesce(email,'-') || '/' || moment, ' ' order by created_at) from contact_requests$q$);
select _t(null, '4e demande du même numéro le même jour : refusée', $q$select envoyer_demande_contact_v2('adhesion','L','D','0612345678','','','sms',''), envoyer_demande_contact_v2('adhesion','L','D','06.12.34.56.78','','','sms',''), envoyer_demande_contact_v2('adhesion','L','D','0612345678','','','sms','')$q$, 'plusieurs demandes');
