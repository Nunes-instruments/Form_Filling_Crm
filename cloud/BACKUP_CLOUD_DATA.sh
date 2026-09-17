#!/usr/bin/env bash
set -euo pipefail
APP_DIR="/opt/nunes-company"
BACKUP_DIR="$APP_DIR/backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/nunes_data_$STAMP.tar.gz"
tar -czf "$OUT" \
  -C "$APP_DIR" \
  apps/order_forms/data \
  apps/service_operations/data
find "$BACKUP_DIR" -type f -name 'nunes_data_*.tar.gz' -mtime +14 -delete
printf '%s\n' "$OUT"
