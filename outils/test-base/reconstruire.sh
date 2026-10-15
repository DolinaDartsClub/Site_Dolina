#!/bin/bash
# Recrée la base de test « dt » avec toutes les migrations du site
set -e
R="$(dirname "$0")/../../supabase"
PSQL="psql -h /tmp -p 5499 -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'dt' and pid <> pg_backend_pid()" -c "drop database if exists dt" -c "create database dt"
$PSQL -d dt -f "$(dirname "$0")/stub.sql"
for f in 001_schema 003_correctif_parties 005_admin 006_actualites 007_profil 008_surnom 009_jouer 011_suppression_parties "$@"; do
  $PSQL -d dt -f $R/$f.sql > /dev/null && echo "ok $f"
done
