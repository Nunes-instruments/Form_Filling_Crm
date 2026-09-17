#!/usr/bin/env bash
set -euo pipefail

# NUNES Company Platform V6.4.1 - Next.js 24x7 Cloud Installer
# Supported target: Ubuntu 22.04/24.04 or Debian 12 cloud VM.
# Run once as root: sudo bash cloud/INSTALL_CLOUD_SERVER.sh

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Please run with sudo: sudo bash cloud/INSTALL_CLOUD_SERVER.sh"
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="/opt/nunes-company"
APP_USER="nunes"
ENV_FILE="/etc/nunes-company.env"
MODE="${NUNES_HOST_MODE:-}"

banner(){
  echo
  echo "======================================================================"
  echo " NUNES COMPANY PLATFORM V6.4.1 - NEXT.JS CLOUD INSTALLER"
  echo "======================================================================"
}

banner
cat <<'TXT'
This installs the complete company system on this cloud server.
After installation the office PC can be switched OFF.

Choose hosting mode:
  1) FREE DOMAIN / HTTPS  (recommended - DuckDNS or your own domain)
  2) PUBLIC IP / HTTP     (quick test; Gmail OAuth is not recommended here)
TXT

if [[ -z "$MODE" ]]; then
  read -r -p "Choose 1 or 2 [1]: " choice
  choice="${choice:-1}"
  [[ "$choice" == "2" ]] && MODE="ip" || MODE="domain"
fi

PUBLIC_IP="$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
if [[ -z "$PUBLIC_IP" ]]; then
  PUBLIC_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

DOMAIN="${NUNES_DOMAIN:-}"
DUCKDNS_TOKEN="${DUCKDNS_TOKEN:-}"
if [[ "$MODE" == "domain" ]]; then
  if [[ -z "$DOMAIN" ]]; then
    echo
    echo "Enter one domain, for example: nunescompany.duckdns.org"
    read -r -p "Domain: " DOMAIN
  fi
  DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN#https://}"
  DOMAIN="${DOMAIN%%/*}"
  DOMAIN="${DOMAIN%%:*}"
  if [[ -z "$DOMAIN" || "$DOMAIN" != *.* ]]; then
    echo "A valid domain name is required for HTTPS mode."
    exit 1
  fi
  if [[ "$DOMAIN" == *.duckdns.org && -z "$DUCKDNS_TOKEN" ]]; then
    echo
    echo "DuckDNS detected. The token is optional when the DNS is already pointed"
    echo "to this VM. Supplying it enables automatic IP refresh."
    read -r -s -p "DuckDNS token (press Enter to skip): " DUCKDNS_TOKEN || true
    echo
  fi
fi

echo
 echo "[1/9] Installing Linux packages..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-venv python3-pip curl ca-certificates gnupg rsync unzip tar ufw git build-essential

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'parseInt(process.versions.node)' 2>/dev/null || echo 0)" -lt 20 ]]; then
  echo "[2/9] Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
else
  echo "[2/9] Node.js $(node -v) already available."
fi

# Chromium is required only for the existing WhatsApp Web engine.
if ! command -v chromium >/dev/null 2>&1 && ! command -v chromium-browser >/dev/null 2>&1 && ! command -v google-chrome >/dev/null 2>&1; then
  echo "[3/9] Installing a headless Chromium browser for WhatsApp..."
  if apt-cache show chromium >/dev/null 2>&1; then
    apt-get install -y chromium || true
  fi
  if ! command -v chromium >/dev/null 2>&1 && apt-cache show chromium-browser >/dev/null 2>&1; then
    apt-get install -y chromium-browser || true
  fi
else
  echo "[3/9] Browser runtime already available."
fi

if [[ "$MODE" == "domain" ]]; then
  echo "[4/9] Installing Caddy HTTPS gateway..."
  if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
  fi
else
  echo "[4/9] HTTPS gateway skipped for public-IP test mode."
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

 echo "[5/9] Installing NUNES application files..."
mkdir -p "$APP_DIR" "$APP_DIR/backups"
# Preserve cloud data during upgrades.
if [[ -d "$APP_DIR/apps/order_forms/data" ]]; then
  mkdir -p /tmp/nunes-preserve/order /tmp/nunes-preserve/service
  cp -a "$APP_DIR/apps/order_forms/data/." /tmp/nunes-preserve/order/ 2>/dev/null || true
  cp -a "$APP_DIR/apps/service_operations/data/." /tmp/nunes-preserve/service/ 2>/dev/null || true
fi
rsync -a --delete \
  --exclude 'apps/order_forms/data/' \
  --exclude 'apps/service_operations/data/' \
  --exclude 'backups/' \
  "$SOURCE_DIR/" "$APP_DIR/"
mkdir -p "$APP_DIR/apps/order_forms/data" "$APP_DIR/apps/service_operations/data" "$APP_DIR/backups"
if [[ -d /tmp/nunes-preserve/order ]]; then
  cp -a /tmp/nunes-preserve/order/. "$APP_DIR/apps/order_forms/data/" 2>/dev/null || true
  cp -a /tmp/nunes-preserve/service/. "$APP_DIR/apps/service_operations/data/" 2>/dev/null || true
  rm -rf /tmp/nunes-preserve
else
  cp -an "$SOURCE_DIR/apps/order_forms/data/." "$APP_DIR/apps/order_forms/data/" 2>/dev/null || true
  cp -an "$SOURCE_DIR/apps/service_operations/data/." "$APP_DIR/apps/service_operations/data/" 2>/dev/null || true
fi

python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/python" -m pip install --upgrade pip wheel
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/apps/order_forms/core_requirements.txt"
if [[ -f "$APP_DIR/apps/order_forms/requirements_google.txt" ]]; then
  "$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/apps/order_forms/requirements_google.txt"
fi

 echo "[6/9] Building Next.js platform and Service Operations..."
export NEXT_TELEMETRY_DISABLED=1
cd "$APP_DIR/platform_web"
npm install --no-audit --no-fund
npm run build
cd "$APP_DIR/apps/service_operations"
npm install --no-audit --no-fund
npm run build

DATA_API_TOKEN="${NUNES_DATA_API_TOKEN:-$(python3 -c 'import secrets; print(secrets.token_hex(32))')}"

if [[ "$MODE" == "domain" ]]; then
  MAIN_URL="https://$DOMAIN"
  ORDER_URL="https://$DOMAIN:8770"
  SERVICE_URL="https://$DOMAIN:5055"
  PLATFORM_PORT=18765
  API_PORT=18766
  ORDER_PORT=18770
  SERVICE_PORT=15055
  WA_PORT=15056
  MODULES_FILE="$APP_DIR/platform/modules.cloud.json"
else
  MAIN_URL="http://$PUBLIC_IP:8765"
  ORDER_URL="http://$PUBLIC_IP:8770"
  SERVICE_URL="http://$PUBLIC_IP:5055"
  PLATFORM_PORT=8765
  API_PORT=8865
  ORDER_PORT=8770
  SERVICE_PORT=5055
  WA_PORT=5056
  MODULES_FILE="$APP_DIR/platform/modules.ip-cloud.json"
fi

cat > "$ENV_FILE" <<ENVEOF
NUNES_CLOUD=1
NUNES_HOST=0.0.0.0
NUNES_PORT=$PLATFORM_PORT
NUNES_API_PORT=$API_PORT
NUNES_API_INTERNAL_URL=http://127.0.0.1:$API_PORT
NUNES_DATA_API_TOKEN=$DATA_API_TOKEN
NUNES_MODULES_FILE=$MODULES_FILE
NUNES_PUBLIC_URL=$MAIN_URL
NUNES_ORDER_PUBLIC_URL=$ORDER_URL
NUNES_SERVICE_PUBLIC_URL=$SERVICE_URL
ORDER_INTERNAL_PORT=$ORDER_PORT
SERVICE_INTERNAL_PORT=$SERVICE_PORT
WHATSAPP_INTERNAL_PORT=$WA_PORT
WHATSAPP_SIDECAR_URL=http://127.0.0.1:$WA_PORT
SERVICEFLOW_PUBLIC_BASE_URL=$SERVICE_URL
SERVICEFLOW_GOOGLE_OAUTH_REDIRECT_URI=$SERVICE_URL
NEXT_TELEMETRY_DISABLED=1
ENVEOF
chmod 640 "$ENV_FILE"
chown root:"$APP_USER" "$ENV_FILE"
cat > /root/NUNES_VERCEL_DATA_API_SECRET.txt <<SECRETEOF
NUNES_API_INTERNAL_URL=${MAIN_URL%/}/company-data
NUNES_DATA_API_TOKEN=$DATA_API_TOKEN
SECRETEOF
chmod 600 /root/NUNES_VERCEL_DATA_API_SECRET.txt

 echo "[7/9] Creating auto-start services..."
cat > /etc/systemd/system/nunes-order.service <<EOF2
[Unit]
Description=NUNES Order and Forms
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/apps/order_forms
EnvironmentFile=$ENV_FILE
Environment=PORT=$ORDER_PORT
ExecStart=$APP_DIR/.venv/bin/python $APP_DIR/apps/order_forms/app.py
Restart=always
RestartSec=4
TimeoutStopSec=20

[Install]
WantedBy=multi-user.target
EOF2

cat > /etc/systemd/system/nunes-whatsapp.service <<EOF2
[Unit]
Description=NUNES Service WhatsApp Runtime
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/apps/service_operations
EnvironmentFile=$ENV_FILE
Environment=WHATSAPP_SIDECAR_PORT=$WA_PORT
Environment=LOCALAPPDATA=$APP_DIR/apps/service_operations/data
ExecStart=/usr/bin/node $APP_DIR/apps/service_operations/scripts/whatsapp-sidecar.js
Restart=always
RestartSec=6
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF2

cat > /etc/systemd/system/nunes-service.service <<EOF2
[Unit]
Description=NUNES Service Operations
After=network-online.target nunes-whatsapp.service
Wants=network-online.target nunes-whatsapp.service

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/apps/service_operations
EnvironmentFile=$ENV_FILE
Environment=PORT=$SERVICE_PORT
ExecStart=/usr/bin/npm run start -- -H 0.0.0.0 -p $SERVICE_PORT
Restart=always
RestartSec=4
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
EOF2

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

# Daily local cloud backup (retains 14 copies).
install -m 755 "$APP_DIR/cloud/BACKUP_CLOUD_DATA.sh" /usr/local/sbin/nunes-cloud-backup
cat > /etc/systemd/system/nunes-backup.service <<EOF2
[Unit]
Description=Backup NUNES cloud data

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/nunes-cloud-backup
EOF2
cat > /etc/systemd/system/nunes-backup.timer <<EOF2
[Unit]
Description=Daily NUNES cloud backup

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true
RandomizedDelaySec=900

[Install]
WantedBy=timers.target
EOF2

if [[ "$MODE" == "domain" ]]; then
  cat > /etc/caddy/Caddyfile <<EOF2
$DOMAIN {
    encode zstd gzip
    handle_path /company-data/* {
        reverse_proxy 127.0.0.1:$API_PORT
    }
    reverse_proxy 127.0.0.1:$PLATFORM_PORT
}

https://$DOMAIN:8770 {
    encode zstd gzip
    reverse_proxy 127.0.0.1:$ORDER_PORT
}

https://$DOMAIN:5055 {
    encode zstd gzip
    reverse_proxy 127.0.0.1:$SERVICE_PORT
}
EOF2
  caddy fmt --overwrite /etc/caddy/Caddyfile || true

  if [[ "$DOMAIN" == *.duckdns.org && -n "$DUCKDNS_TOKEN" ]]; then
    DUCK_SUB="${DOMAIN%.duckdns.org}"
    cat > /usr/local/sbin/nunes-duckdns-update <<EOF2
#!/usr/bin/env bash
curl -fsS "https://www.duckdns.org/update?domains=$DUCK_SUB&token=$DUCKDNS_TOKEN&ip=" >/dev/null
EOF2
    chmod 700 /usr/local/sbin/nunes-duckdns-update
    /usr/local/sbin/nunes-duckdns-update || true
    cat > /etc/systemd/system/nunes-duckdns.service <<EOF2
[Unit]
Description=Update NUNES DuckDNS address
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/nunes-duckdns-update
EOF2
    cat > /etc/systemd/system/nunes-duckdns.timer <<EOF2
[Unit]
Description=Refresh NUNES DuckDNS address

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
EOF2
    systemctl enable --now nunes-duckdns.timer
  fi
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
systemctl daemon-reload
systemctl enable nunes-order.service nunes-whatsapp.service nunes-service.service nunes-data-api.service nunes-platform.service nunes-backup.timer
systemctl restart nunes-order.service
systemctl restart nunes-whatsapp.service
systemctl restart nunes-service.service
systemctl restart nunes-data-api.service
systemctl restart nunes-platform.service
systemctl start nunes-backup.timer

if [[ "$MODE" == "domain" ]]; then
  systemctl enable --now caddy
  systemctl restart caddy
fi

 echo "[8/9] Configuring server firewall..."
ufw allow OpenSSH >/dev/null 2>&1 || true
if [[ "$MODE" == "domain" ]]; then
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw allow 8770/tcp >/dev/null 2>&1 || true
  ufw allow 5055/tcp >/dev/null 2>&1 || true
else
  ufw allow 8765/tcp >/dev/null 2>&1 || true
  ufw allow 8770/tcp >/dev/null 2>&1 || true
  ufw allow 5055/tcp >/dev/null 2>&1 || true
fi
ufw --force enable >/dev/null 2>&1 || true

 echo "[9/9] Checking services..."
sleep 3
for svc in nunes-order nunes-whatsapp nunes-service nunes-data-api nunes-platform; do
  if systemctl is-active --quiet "$svc.service"; then
    printf '  %-20s READY\n' "$svc"
  else
    printf '  %-20s CHECK LOG\n' "$svc"
  fi
done

cat > "$APP_DIR/CLOUD_URL.txt" <<EOF2
NUNES Company Platform V6.4.1

MAIN URL
$MAIN_URL

Purchasing Form (opened from Forms)
$ORDER_URL

Servicing Form (opened from Forms)
$SERVICE_URL

The office/main PC does NOT need to be on after this cloud server is installed.
The main URL opens the Next.js Owner Dashboard. Forms contains Purchasing and Servicing.
EOF2

banner
echo "INSTALLATION COMPLETE"
echo
echo "Main company URL: $MAIN_URL"
echo "Workers only need this MAIN URL. Open Forms, then choose Purchasing or Servicing."
echo
if [[ "$MODE" == "domain" ]]; then
  echo "IMPORTANT: Your cloud provider firewall/security list must allow inbound TCP:"
  echo "  80, 443, 8770 and 5055"
else
  echo "IMPORTANT: Your cloud provider firewall/security list must allow inbound TCP:"
  echo "  8765, 8770 and 5055"
fi
echo "The Linux firewall on this VM has already been configured."
echo
echo "Status: sudo bash $APP_DIR/cloud/CHECK_CLOUD_STATUS.sh"
echo "URL file: $APP_DIR/CLOUD_URL.txt"
echo "======================================================================"
