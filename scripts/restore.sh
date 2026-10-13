#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$#" -ne 2 ] || [ "$2" != "--confirm-replace" ]; then
  printf 'Usage: sh scripts/restore.sh backups/example.dump --confirm-replace\nReplaces the current database. Back up first.\n' >&2
  exit 1
fi
test -f "$1"
docker compose stop app
trap 'docker compose start app' EXIT HUP INT TERM
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction --no-owner --no-acl' < "$1"
# Invalidate restored sessions: old cookies must not regain access after a restore.
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\''DELETE FROM "Session"; DELETE FROM "Operation";'\'''
printf 'Database restored. All users must log in again.\n'
