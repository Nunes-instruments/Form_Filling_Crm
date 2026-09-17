#!/usr/bin/env bash
set -euo pipefail
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "Run with sudo."; exit 1; fi
APP_DIR=/opt/nunes-company
latest="$(find "$APP_DIR/backups" -type f -name 'nunes_data_*.tar.gz' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
[[ -n "$latest" ]] || { echo "No backup found."; exit 1; }
systemctl stop nunes-order nunes-service nunes-whatsapp nunes-platform
mkdir -p "$APP_DIR/.restore-tmp"
tar -xzf "$latest" -C "$APP_DIR"
chown -R nunes:nunes "$APP_DIR/apps/order_forms/data" "$APP_DIR/apps/service_operations/data"
systemctl start nunes-order nunes-whatsapp nunes-service nunes-platform
echo "Restored: $latest"
