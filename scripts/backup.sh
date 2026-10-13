#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
umask 077
mkdir -p backups
destination="backups/turntable-$(date -u +%Y%m%dT%H%M%SZ).dump"
partial="${destination}.partial"
trap 'rm -f "$partial"' EXIT HUP INT TERM
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$partial"
test -s "$partial"
mv "$partial" "$destination"
find backups -type f -name 'turntable-*.dump' -mtime +6 -delete
printf 'Backup created: %s\n' "$destination"
