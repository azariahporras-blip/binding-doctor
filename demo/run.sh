#!/usr/bin/env bash
# Reproducible 90-second demo. Record with:
#   asciinema rec demo.cast -c "bash demo/run.sh"
# or any screen recorder while running this.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Fancy output
B='\033[1m'; G='\033[32m'; Y='\033[33m'; D='\033[2m'; R='\033[0m'
say() { echo -e "${B}${1}${R}"; sleep 1; }
beat() { sleep 1.5; }

# Reset the demo project to a pristine state
cp demo/wrangler.toml.template demo/wrangler.toml
rm -f demo/wrangler.toml.bak

clear
say "# Binding Doctor — 90s demo"
beat

say "## 1. Empty Worker, no bindings declared"
echo -e "${D}$ cat demo/wrangler.toml${R}"
cat demo/wrangler.toml
beat
echo
echo -e "${D}$ cat demo/src/index.ts${R}"
sed -n '1,12p' demo/src/index.ts
beat

say "## 2. bdr diff — finds the gap"
echo -e "${D}$ bdr diff demo${R}"
node dist/cli.js diff demo
beat

say "## 3. bdr apply — creates resources, wires bindings, runs migrations"
echo -e "${D}$ bdr apply demo --yes${R}"
node dist/cli.js apply demo --yes
beat

say "## 4. wrangler.toml is now ready to deploy"
echo -e "${D}$ cat demo/wrangler.toml${R}"
cat demo/wrangler.toml
beat

say "## 5. Idempotent — re-run = zero diff"
echo -e "${D}$ bdr diff demo${R}"
node dist/cli.js diff demo
beat

say "## 6. Drift — somebody deletes a resource in the dashboard"
KV_ID=$(awk '/kv_namespaces/{f=1} f && /id =/ {gsub(/"/,""); print $3; exit}' demo/wrangler.toml)
echo -e "${D}$ curl -X DELETE .../storage/kv/namespaces/${KV_ID} (simulating dashboard delete)${R}"
set +e
curl -sf -X DELETE "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" > /dev/null
set -e
beat

echo -e "${D}$ bdr diff demo${R}"
node dist/cli.js diff demo
beat

say "## 7. bdr apply heals the drift"
echo -e "${D}$ bdr apply demo --yes${R}"
node dist/cli.js apply demo --yes
beat

say "${G}Wrangler ships your code. Doctor wires your stack."
say "${G}github.com/diogodebastos/binding-doctor"
