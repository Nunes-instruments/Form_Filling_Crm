#!/usr/bin/env bash
set -u
printf '\nNUNES PLATFORM V6 STATUS\n========================\n'
for svc in nunes-platform nunes-data-api nunes-order nunes-service nunes-whatsapp caddy; do
  if systemctl list-unit-files "$svc.service" >/dev/null 2>&1; then
    state="$(systemctl is-active "$svc.service" 2>/dev/null || true)"
    printf '%-20s %s\n' "$svc" "$state"
  fi
done
printf '\nURLs\n----\n'
cat /opt/nunes-company/CLOUD_URL.txt 2>/dev/null || true
printf '\nRecent errors\n-------------\n'
journalctl -u nunes-platform -u nunes-data-api -u nunes-order -u nunes-service -u nunes-whatsapp --since '-10 min' -p warning --no-pager 2>/dev/null | tail -50 || true
