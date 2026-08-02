#!/usr/bin/env bash
# Automated MariaDB backup for Naija Ride.
#
# Usage:  ./scripts/backup_db.sh [db_name]
#
# Dumps the configured database to backend/backups/ with a timestamp and
# prunes backups older than BACKUP_KEEP_DAYS (default 14).
#
# Schedule it with cron, e.g. daily at 3am:
#   0 3 * * * cd /path/to/Naija-ride-main/backend && ./scripts/backup_db.sh >> logs/backup.log 2>&1
set -euo pipefail

DB_NAME="${1:-${DB_NAME:-test_db}}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_PASSWORD="${MYSQL_PASSWORD:-root1234}"
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/${DB_NAME}_${STAMP}.sql.gz"

if command -v mariadb-dump >/dev/null 2>&1; then
  DUMPER="mariadb-dump"
elif command -v mysqldump >/dev/null 2>&1; then
  DUMPER="mysqldump"
else
  echo "ERROR: neither mysqldump nor mariadb-dump found" >&2
  exit 1
fi

MYSQL_PWD="$MYSQL_PASSWORD" "$DUMPER" \
  --host="$MYSQL_HOST" --user="$MYSQL_USER" \
  --single-transaction --routines --triggers \
  "$DB_NAME" | gzip > "$OUT"

echo "backup written: $OUT"

# Prune old backups.
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime "+${KEEP_DAYS}" -delete
echo "pruned backups older than ${KEEP_DAYS} days"
