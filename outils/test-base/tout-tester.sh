#!/bin/bash
# =====================================================================
#  Lance TOUTE la batterie de tests de la base, dans le bon ordre.
#  Prérequis : Postgres 16 local sur /tmp port 5499 (voir LISEZMOI.md).
#  Chaque groupe repart d'une base neuve (reconstruire.sh + seed + harness).
#  Affiche une ligne par groupe puis le total ; code de sortie 1 si un échec.
# =====================================================================
cd "$(dirname "$0")"
PSQL="psql -h /tmp -p 5499 -U postgres -d dt"
M=$(ls ../../supabase/ | grep -E '^0(1[2-9]|[2-9][0-9])_.*\.sql$' | sed 's/\.sql$//' | tr '\n' ' ')
# Groupes : les tests d'un même groupe s'enchaînent sur la même base
GROUPES=(
  "test-t4 test-t3 test-grand test-t2 test-t1 test-suppression-tournoi"
  "test-t3 test-compte"
)
for f in test-*.sql; do
  n=${f%.sql}
  case " test-t1 test-t2 test-t3 test-t4 test-grand test-suppression-tournoi test-compte " in *" $n "*) continue ;; esac
  GROUPES+=("$n")
done
total=0; echecs=0
for g in "${GROUPES[@]}"; do
  bash reconstruire.sh $M > /dev/null 2>&1 || { echo "ÉCHEC reconstruction de la base"; exit 1; }
  $PSQL -q -f seed.sql -f harness.sql > /dev/null 2>&1
  args=""; for t in $g; do args="$args -f $t.sql"; done
  out=$($PSQL $args 2>&1)
  p=$(echo "$out" | grep -c '^PASS'); e=$(echo "$out" | grep -cE '^FAIL|ERROR')
  total=$((total + p)); echecs=$((echecs + e))
  printf '%-70s %4d PASS %s\n' "$g" "$p" "$([ $e -gt 0 ] && echo "· $e ÉCHEC(S)")"
  [ $e -gt 0 ] && echo "$out" | grep -E '^FAIL|ERROR' | sed 's/^/    /'
done
echo "TOTAL : $total vérifications réussies, $echecs échec(s)"
[ $echecs -eq 0 ]
