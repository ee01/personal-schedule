#!/usr/bin/env bash
# Personal Schedule — repeatable deployment to rcadmin@10.32.56.212
# Entry: http://schedule.xmnup.com/ → Nginx Proxy Manager (docker) → 10.32.56.212:3230
#
# Safety rules (per E-183):
#  - never touch other sites: the NPM database and conf are backed up before any
#    change; a proxy host for schedule.xmnup.com is only added if absent.
#  - nginx -t must pass before reload; reload happens only inside the NPM container.
#  - the app runs under its own launchd label; rollback = previous release dir
#    + NPM backups (see docs/operations/deployment.md).
#
# Usage:
#   ./deploy/deploy.sh preflight   # check server, ports, existing config
#   ./deploy/deploy.sh app         # rsync service + install launchd + start
#   ./deploy/deploy.sh nginx       # add NPM proxy host (idempotent) + reload
#   ./deploy/deploy.sh verify      # health checks via 127.0.0.1 and domain
#   ./deploy/deploy.sh all
set -euo pipefail

HOST=rcadmin@10.32.56.212
APP_DIR='$HOME/personal-schedule'
PORT=3230
DOMAIN=schedule.xmnup.com
NPM_DIR='$HOME/nginxproxymanager'
NPM_CONTAINER=nginxproxymanager-app-1
STAMP=$(date +%Y%m%d-%H%M%S)
HERE="$(cd "$(dirname "$0")" && pwd)"

ssh_run() { ssh -o ConnectTimeout=10 -o BatchMode=yes "$HOST" "export PATH=/usr/local/bin:\$PATH; $*"; }

preflight() {
  echo "== preflight =="
  ssh_run 'node -v' || { echo "FATAL: node missing on server"; exit 1; }
  echo "-- port $PORT in use?"
  ssh_run "lsof -iTCP:$PORT -sTCP:LISTEN -P -n | tail -1" || true
  echo "-- existing NPM proxy hosts:"
  scp -q "$HERE/npm_host.py" "$HOST:/tmp/npm_host.py"
  ssh_run 'python3 /tmp/npm_host.py list'
  echo "-- existing app dir / launchd label:"
  ssh_run 'ls -d ~/personal-schedule 2>/dev/null || echo "app dir: none"; launchctl list 2>/dev/null | grep personal-schedule || echo "launchd: not loaded"'
  echo "-- domain resolves to:"
  dig +short "$DOMAIN"
}

deploy_app() {
  echo "== deploy app =="
  ssh_run 'mkdir -p ~/personal-schedule/releases ~/personal-schedule/data'
  ssh_run "[ -d ~/personal-schedule/current ] && cp -a ~/personal-schedule/current ~/personal-schedule/releases/$STAMP || true"
  rsync -az --delete --exclude data --exclude '.DS_Store' --exclude .DS_Store \
    "$HERE/../service/" "$HOST:personal-schedule/current/"
  cat > /tmp/com.personal-schedule.service.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.personal-schedule.service</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/rcadmin/personal-schedule/current/src/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/rcadmin/personal-schedule/current</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SCHEDULE_PORT</key><string>$PORT</string>
    <key>SCHEDULE_HOST</key><string>0.0.0.0</string>
    <key>SCHEDULE_DATA_DIR</key><string>/Users/rcadmin/personal-schedule/data</string>
    <key>SCHEDULE_PUBLIC_URL</key><string>http://$DOMAIN</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/rcadmin/personal-schedule/schedule.log</string>
  <key>StandardErrorPath</key><string>/Users/rcadmin/personal-schedule/schedule.err.log</string>
</dict>
</plist>
EOF
  scp -q /tmp/com.personal-schedule.service.plist "$HOST:~/Library/LaunchAgents/com.personal-schedule.service.plist"
  ssh_run 'launchctl bootout gui/$(id -u)/com.personal-schedule.service 2>/dev/null || true; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.personal-schedule.service.plist'
  sleep 2
  ssh_run "curl -sf http://127.0.0.1:$PORT/api/v1/health" && echo " (local health OK)"
}

deploy_nginx() {
  echo "== deploy nginx proxy host =="
  ssh_run "cp $NPM_DIR/data/database.sqlite $NPM_DIR/data/database.sqlite.bak-$STAMP"
  scp -q "$HERE/npm_host.py" "$HOST:/tmp/npm_host.py"
  local result
  result=$(ssh_run "python3 /tmp/npm_host.py add $DOMAIN 10.32.56.212 $PORT")
  echo "$result"
  local conf_id
  conf_id=$(echo "$result" | awk '/(exists|inserted)/{print $2}')
  if [ -z "$conf_id" ]; then echo "FATAL: could not determine proxy host id"; exit 1; fi
  # write the conf file nginx actually loads (modeled on the existing hosts)
  cat > "/tmp/ps-$conf_id.conf" <<EOF
# ------------------------------------------------------------
# $DOMAIN
# ------------------------------------------------------------
server {
  set \$forward_scheme http;
  set \$server         10.32.56.212;
  set \$port           $PORT;

  listen 80;
  listen [::]:80;

  server_name $DOMAIN;
  http2 off;

  access_log /data/logs/proxy-host-${conf_id}_access.log proxy;
  error_log /data/logs/proxy-host-${conf_id}_error.log warn;

  location / {
    include conf.d/include/proxy.conf;
  }

  include /data/nginx/custom/server_proxy[.]conf;
}
EOF
  scp -q "/tmp/ps-$conf_id.conf" "$HOST:/tmp/ps-$conf_id.conf"
  ssh_run "cp $NPM_DIR/data/nginx/proxy_host/$conf_id.conf $NPM_DIR/data/nginx/proxy_host/$conf_id.conf.bak-$STAMP 2>/dev/null || true; cp /tmp/ps-$conf_id.conf $NPM_DIR/data/nginx/proxy_host/$conf_id.conf"
  if ! ssh_run "docker exec $NPM_CONTAINER nginx -t"; then
    echo "FATAL: nginx -t failed — rolling back conf"
    ssh_run "[ -f $NPM_DIR/data/nginx/proxy_host/$conf_id.conf.bak-$STAMP ] && mv $NPM_DIR/data/nginx/proxy_host/$conf_id.conf.bak-$STAMP $NPM_DIR/data/nginx/proxy_host/$conf_id.conf || rm $NPM_DIR/data/nginx/proxy_host/$conf_id.conf"
    exit 1
  fi
  ssh_run "docker exec $NPM_CONTAINER nginx -s reload"
  echo "nginx reloaded (proxy host $conf_id)"
}

verify() {
  echo "== verify =="
  echo "-- via 127.0.0.1:"
  ssh_run "curl -sf http://127.0.0.1:$PORT/api/v1/health || tail -5 ~/personal-schedule/schedule.err.log"
  echo; echo "-- via domain:"
  curl -sf "http://$DOMAIN/api/v1/health" && echo " (OK)" || { echo "FAILED via domain"; exit 1; }
  echo "-- web app / share page:"
  curl -sf -o /dev/null -w "app %{http_code}\n" "http://$DOMAIN/app"
  curl -sf -o /dev/null -w "share-shell %{http_code}\n" "http://$DOMAIN/share/test"
}

cmd=${1:-all}
case "$cmd" in
  preflight) preflight ;;
  app) deploy_app ;;
  nginx) deploy_nginx ;;
  verify) verify ;;
  all) preflight && deploy_app && deploy_nginx && verify ;;
  *) echo "usage: $0 {preflight|app|nginx|verify|all}"; exit 1 ;;
esac
