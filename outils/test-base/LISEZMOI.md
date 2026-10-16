# Tests de la base (Postgres local)

Vérifient les règles écrites dans les scripts `supabase/*.sql` (droits, inscriptions…)
sur une base Postgres 16 locale, sans toucher à Supabase.

```
M="012_tournois 013_tournois_tirage 014_accueil_tournois 015_guide_finish 016_tournois_matchs 017_tournois_corrections 018_contact 019_stats 020_stats_tournoi 021_classement 022_sans_solo 023_face_a_face 024_sauvegarde 025_photos_profil 026_compte_rgpd 027_suppression_tournoi 028_poules_cibles"
# Chaque ligne affiche PASS ou FAIL. Repartir d'une base neuve avant chaque groupe :
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql && psql -d dt -f test-t4.sql -f test-t3.sql -f test-grand.sql -f test-t2.sql -f test-t1.sql   # tournois, parties (163)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql && psql -d dt -f test-stats.sql                     # statistiques (9)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql && psql -d dt -f test-photos.sql                    # photos de profil (19)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-t3.sql && psql -d dt -f test-compte.sql   # suppression de compte, export (19)
```

`stub.sql` imite le minimum de Supabase (schéma auth, auth.uid(), rôles anon / authenticated).
