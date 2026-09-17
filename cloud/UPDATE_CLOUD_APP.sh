#!/usr/bin/env bash
# NUNES Company Platform V6.3 update - upgrades V4 cloud installs safely.
set -euo pipefail
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "Run with sudo."; exit 1; fi
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="/opt/nunes-company"
APP_USER="nunes"
ENV_FILE="/etc/nunes-company.env"
/usr/local/sbin/nunes-cloud-backup >/dev/null 2>&1 || true
rsync -a --delete --exclude 'apps/order_forms/data/' --exclude 'apps/service_operations/data/' --exclude 'backups/' "$SOURCE_DIR/" "$APP_DIR/"
export NEXT_TELEMETRY_DISABLED=1
cd "$APP_DIR/platform_web"
npm install --no-audit --no-fund
npm run build
cd "$APP_DIR/apps/service_operations"
npm install --no-audit --no-fund
npm run build

# Read the existing platform port from the V4/V6 environment.
PLATFORM_PORT="$(grep -E '^NUNES_PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2 || true)"
PLATFORM_PORT="${PLATFORM_PORT:-18765}"
if [[ "$PLATFORM_PORT" == "8765" ]]; then API_PORT=8865; else API_PORT=$((PLATFORM_PORT+1)); fi
# Append/replace V6 API settings without changing existing domain/module URLs.
if grep -q '^NUNES_API_PORT=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s#^NUNES_API_PORT=.*#NUNES_API_PORT=$API_PORT#" "$ENV_FILE"
else
  echo "NUNES_API_PORT=$API_PORT" >> "$ENV_FILE"
fi
if grep -q '^NUNES_API_INTERNAL_URL=' "$ENV_FILE" 2>/dev/null; then
  sed -i "s#^NUNES_API_INTERNAL_URL=.*#NUNES_API_INTERNAL_URL=http://127.0.0.1:$API_PORT#" "$ENV_FILE"
else
  echo "NUNES_API_INTERNAL_URL=http://127.0.0.1:$API_PORT" >> "$ENV_FILE"
fi

if ! grep -q '^NUNES_DATA_API_TOKEN=' "$ENV_FILE" 2>/dev/null; then
  DATA_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  echo "NUNES_DATA_API_TOKEN=$DATA_API_TOKEN" >> "$ENV_FILE"
else
  DATA_API_TOKEN="$(grep -E '^NUNES_DATA_API_TOKEN=' "$ENV_FILE" | tail -1 | cut -d= -f2-)"
fi

PUBLIC_URL="$(grep -E '^NUNES_PUBLIC_URL=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [[ "$PUBLIC_URL" == https://* && -f /etc/caddy/Caddyfile ]]; then
  DOMAIN="${PUBLIC_URL#https://}"; DOMAIN="${DOMAIN%%/*}"; DOMAIN="${DOMAIN%%:*}"
  python3 - "$DOMAIN" "$API_PORT" <<'PY_CADDY'
from pathlib import Path
import sys
p=Path('/etc/caddy/Caddyfile')
s=p.read_text()
domain=sys.argv[1]; api_port=sys.argv[2]
marker='handle_path /company-data/*'
if marker not in s:
    target=f"{domain} {{\n"
    inject=(f"{domain} {{\n"
            f"    handle_path /company-data/* {{\n"
            f"        reverse_proxy 127.0.0.1:{api_port}\n"
            f"    }}\n")
    if target in s:
        s=s.replace(target, inject, 1)
        p.write_text(s)
PY_CADDY
  caddy fmt --overwrite /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  systemctl restart caddy 2>/dev/null || true
  cat > /root/NUNES_VERCEL_DATA_API_SECRET.txt <<SECRETEOF
NUNES_API_INTERNAL_URL=${PUBLIC_URL%/}/company-data
NUNES_DATA_API_TOKEN=$DATA_API_TOKEN
SECRETEOF
  chmod 600 /root/NUNES_VERCEL_DATA_API_SECRET.txt
fi

cat > /etc/systemd/system/nunes-data-api.service <<EOF2
[Unit]
Description=NUNES Company Data API
After=network-online.target nunes-order.service nunes-service.service
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/platform
EnvironmentFile=$ENV_FILE
Environment=NUNES_API_PORT=$API_PORT
ExecStart=/usr/bin/python3 $APP_DIR/platform/server.py
Restart=always
RestartSec=4
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF2

cat > /etc/systemd/system/nunes-platform.service <<EOF2
[Unit]
Description=NUNES Company Platform Next.js
After=network-online.target nunes-data-api.service
Wants=network-online.target nunes-data-api.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/platform_web
EnvironmentFile=$ENV_FILE
Environment=PORT=$PLATFORM_PORT
Environment=HOSTNAME=0.0.0.0
ExecStart=/usr/bin/npm run start -- -H 0.0.0.0 -p $PLATFORM_PORT
Restart=always
RestartSec=4
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF2

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
systemctl daemon-reload
systemctl enable nunes-data-api.service nunes-platform.service
systemctl restart nunes-order nunes-whatsapp nunes-service nunes-data-api nunes-platform
systemctl restart caddy 2>/dev/null || true
echo "V6.3 live-sync + speed architecture installed. Main URL remains unchanged."
