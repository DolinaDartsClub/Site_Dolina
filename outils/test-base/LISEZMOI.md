# Tests de la base (Postgres local)

Vérifient les règles écrites dans les scripts `supabase/*.sql` (droits, inscriptions…)
sur une base Postgres 16 locale, sans toucher à Supabase.

```
./reconstruire.sh 012_tournois 013_tournois_tirage 014_accueil_tournois 015_guide_finish 016_tournois_matchs 017_tournois_corrections         # base « dt » : toutes les migrations
psql -d dt -f seed.sql -f harness.sql   # utilisateurs de test + outil _t()
psql -d dt -f test-t4.sql -f test-t3.sql -f test-grand.sql -f test-t2.sql -f test-t1.sql   # chaque ligne affiche PASS ou FAIL
```

`stub.sql` imite le minimum de Supabase (schéma auth, auth.uid(), rôles anon / authenticated).
