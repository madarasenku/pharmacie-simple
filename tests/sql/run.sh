#!/usr/bin/env bash
# Rejoue les migrations puis le scénario métier sur une base PostgreSQL jetable.
# Usage : PGHOST=... PGPORT=... PGUSER=postgres tests/sql/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
BASE="pharmacie_test_$$"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "create database $BASE" >/dev/null
trap 'psql -q -d postgres -c "drop database if exists $BASE" >/dev/null' EXIT
psql -v ON_ERROR_STOP=1 -q -d "$BASE" -f tests/sql/supabase_local.sql >/dev/null
for f in supabase/migrations/*.sql; do
  psql -v ON_ERROR_STOP=1 -q -d "$BASE" -f "$f" >/dev/null || { echo "Échec de la migration $f"; exit 1; }
done
psql -v ON_ERROR_STOP=1 -q -d "$BASE" -f tests/sql/scenario.sql
