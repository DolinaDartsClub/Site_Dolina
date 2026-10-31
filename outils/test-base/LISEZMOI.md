# Tests de la base (Postgres local)

Vérifient les règles écrites dans les scripts `supabase/*.sql` (droits, inscriptions…)
sur une base Postgres 16 locale, sans toucher à Supabase.

## Tout lancer d'un coup

```
bash tout-tester.sh      # 31 groupes, base neuve pour chacun ; total et code de sortie 1 si un échec
```

État au 31/10/2026 : **649 vérifications réussies, 0 échec**. Ordre imposé : `test-suppression-tournoi`
après les tests t1 à t4, `test-compte` après `test-t3` (le script s'en charge).

## Lancer un groupe à la main

```
M=$(ls ../../supabase/ | grep -E '^0(1[2-9]|[2-9][0-9])_.*\.sql$' | sed 's/\.sql$//' | tr '\n' ' ')   # tous les scripts à partir de 012
# Chaque ligne affiche PASS ou FAIL. Repartir d'une base neuve avant chaque groupe :
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql && psql -d dt -f test-t4.sql -f test-t3.sql -f test-grand.sql -f test-t2.sql -f test-t1.sql   # tournois, parties (163)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql && psql -d dt -f test-stats.sql                     # statistiques (9)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql && psql -d dt -f test-photos.sql                    # photos de profil (19)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-t3.sql && psql -d dt -f test-compte.sql   # suppression de compte, export (19)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-calendrier.sql                 # calendrier des équipes (16)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-records.sql                    # records du club (8)
```

`stub.sql` imite le minimum de Supabase (schéma auth, auth.uid(), rôles anon / authenticated).
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-feuille.sql                     # feuille de match CPARD, scripts 056-057 (69)
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-niveaux.sql                    # niveaux (admin) et poules de la ligue, scripts 060-063
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-email-ajout.sql                # email ajouté à un compte sans email, script 061
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-b-double.sql                  # tableau B en double élimination, script 065
./reconstruire.sh $M && psql -d dt -f seed.sql -f harness.sql -f test-prolongation.sql              # prolongation des matchs, script 067
