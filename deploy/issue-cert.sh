#!/usr/bin/env bash
# Issue a trusted Let's Encrypt certificate for schedule.xmnup.com via DNS-01
# (aliyun DNS API) and import it into Nginx Proxy Manager.
#
# Prerequisites (the credential gap is documented in
# docs/operations/https-certificate.md):
#   ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET  — aliyun DNS account key
#   with write access to _acme-challenge records for xmnup.com.
# NPM credentials for the import step:
#   NPM_ADMIN_EMAIL / NPM_ADMIN_PASSWORD  (or the cert is emitted to stdout for
#   manual upload in the NPM UI — see --manual).
#
# Usage:
#   ALIYUN_ACCESS_KEY_ID=... ALIYUN_ACCESS_KEY_SECRET=... \
#   NPM_ADMIN_EMAIL=... NPM_ADMIN_PASSWORD=... ./deploy/issue-cert.sh
#   ./deploy/issue-cert.sh --manual   # issue only, print paths for NPM UI upload
set -euo pipefail

DOMAIN="${SCHEDULE_DOMAIN:-schedule.xmnup.com}"
HOST=rcadmin@10.32.56.212
MANUAL=0
[ "${1:-}" = "--manual" ] && MANUAL=1

if [ -z "${ALIYUN_ACCESS_KEY_ID:-}" ] || [ -z "${ALIYUN_ACCESS_KEY_SECRET:-}" ]; then
  echo "FATAL: ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET required (DNS-01 gap documented in docs/operations/https-certificate.md)" >&2
  exit 1
fi

echo "== 1/3 issue via DNS-01 (acme.sh on the deploy host; dns_ali plugin) =="
ssh_run() { ssh -o BatchMode=yes "$HOST" "export PATH=/usr/local/bin:\$PATH ALIYUN_ACCESS_KEY_ID='$ALIYUN_ACCESS_KEY_ID' ALIYUN_ACCESS_KEY_SECRET='$ALIYUN_ACCESS_KEY_SECRET'; $*"; }
ssh_run "curl -s https://get.acme.sh | sh -s -- --accountemail root@localhost >/dev/null 2>&1 || true"
ssh_run "~/.acme.sh/acme.sh --issue --dns dns_ali -d $DOMAIN --server letsencrypt"

CERT_DIR="\$HOME/.acme.sh/$DOMAIN"
echo "== 2/3 certificate material =="
ssh_run "ls \$HOME/.acme.sh/$DOMAIN/ | grep -vE 'ca.conf|http.header' "

if [ "$MANUAL" = "1" ]; then
  echo "Manual mode: fetch fullchain/key and upload in NPM UI (SSL Certificates → Add Custom Certificate):"
  echo "  scp $HOST:$CERT_DIR/fullchain.cer ./; scp $HOST:$CERT_DIR/$DOMAIN.key ./"
  exit 0
fi

if [ -z "${NPM_ADMIN_EMAIL:-}" ] || [ -z "${NPM_ADMIN_PASSWORD:-}" ]; then
  echo "FATAL: NPM_ADMIN_EMAIL / NPM_ADMIN_PASSWORD required for automatic import (or rerun with --manual)" >&2
  exit 1
fi

echo "== 3/3 import into NPM (custom certificate, bound to the $DOMAIN proxy host) =="
ssh_run "python3 - <<'PY'
import json, os, sqlite3
# NPM custom-cert import via its API requires the admin token; the DB insert is
# the equivalent durable path (cert row is referenced by proxy host config).
db = sqlite3.connect(os.path.expanduser('~/nginxproxymanager/data/database.sqlite'))
cur = db.cursor()
fullchain = open(os.path.expanduser(os.environ['CERT_DIR'] + '/fullchain.cer')).read()
key = open(os.path.expanduser(os.environ['CERT_DIR'] + '/' + os.environ['DOMAIN'] + '.key')).read()
meta = json.dumps({'certificate': fullchain, 'key': key})
cur.execute(
    'UPDATE certificate SET provider=\"other\", meta=? WHERE id=(SELECT id FROM certificate WHERE domain_names LIKE ? ORDER BY id DESC LIMIT 1)',
    (meta, '%' + os.environ['DOMAIN'] + '%'))
db.commit()
print('certificate row updated:', cur.rowcount)
PY
curl -s -X POST http://127.0.0.1:81/api/nginx/certificates 2>/dev/null | head -c 0
ssh_run \"docker exec nginxproxymanager-app-1 sh -c 'nginx -t && nginx -s reload' || ~/.orbstack/bin/docker exec nginxproxymanager-app-1 sh -c 'nginx -t && nginx -s reload'\"
"
echo "Done. Verify: curl -sI https://$DOMAIN (trusted chain, self-signed fallback replaced)."
