#!/bin/bash
#
# Nightly Postgres backup for the Sonar trading DB, with a verified dump BEFORE
# any prune. Invoked from the root crontab:
#
#   0 3 * * * /root/sonar/ops/backup.sh >> /var/log/sonar-backup.log 2>&1
#
# The previous one-liner piped pg_dump into gzip and gated the 7-day prune on the
# pipeline's exit status. In a pipe that status is gzip's, and gzip happily
# compresses empty input, so a FAILED pg_dump wrote a valid-looking tiny archive
# and the prune still ran. Eight failed nights would silently delete every real
# backup of the trading database. This script fails loudly instead.

set -euo pipefail

DIR=/root/backups
FLOOR_BYTES=10000          # a real dump is ~1.4MB; anything under this is broken
RETAIN_DAYS=7

mkdir -p "$DIR"
stamp=$(date +%Y%m%d-%H%M)
tmp="$DIR/.sonar-$stamp.sql.gz.partial"
final="$DIR/sonar-$stamp.sql.gz"

cleanup() { rm -f "$tmp"; }
trap cleanup EXIT

# pipefail is set, so a pg_dump failure fails the whole pipeline here rather than
# being masked by gzip's success.
docker exec sonar-pg pg_dump -U sonar -d sonar | gzip > "$tmp"

size=$(stat -c%s "$tmp")
if [ "$size" -lt "$FLOOR_BYTES" ]; then
  echo "$(date -u +%FT%TZ) BACKUP FAILED: dump is ${size} bytes (< ${FLOOR_BYTES}); keeping existing backups, NOT pruning." >&2
  exit 1
fi

# Only now, with a verified dump on disk, publish it and prune old ones.
mv "$tmp" "$final"
trap - EXIT
echo "$(date -u +%FT%TZ) backup ok: $final (${size} bytes)"
find "$DIR" -name "sonar-*.sql.gz" -mtime +"$RETAIN_DAYS" -delete
