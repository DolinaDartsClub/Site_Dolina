# Tests de la base (Postgres local)

Vérifient les règles écrites dans les scripts `supabase/*.sql` (droits, inscriptions…)
sur une base Postgres 16 locale, sans toucher à Supabase.

```
./reconstruire.sh 012_tournois          # base « dt » : toutes les migrations
psql -d dt -f seed.sql -f harness.sql   # utilisateurs de test + outil _t()
psql -d dt -f test-t1.sql               # chaque ligne affiche PASS ou FAIL
```

`stub.sql` imite le minimum de Supabase (schéma auth, auth.uid(), rôles anon / authenticated).
