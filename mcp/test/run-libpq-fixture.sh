#!/usr/bin/env bash
# Disposable local-only TLS fixture. Run as a non-root user from repository root.
set -euo pipefail
: "${MIGRATION_PYTHON:?Set the reviewed Python 3.12 venv interpreter}"
for tool in initdb pg_ctl openssl node; do command -v "$tool" >/dev/null; done
cluster=$(mktemp -d "${TMPDIR:-/tmp}/arcana-libpq-test.XXXXXX")
cleanup() { pg_ctl -D "$cluster/data" -m fast -w stop >/dev/null 2>&1 || true; }
trap cleanup EXIT
printf '%s\n' local-test-only > "$cluster/password"
initdb -D "$cluster/data" -U migration_test --pwfile="$cluster/password" --auth-local=trust --auth-host=scram-sha-256 > "$cluster/init.log"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$cluster/data/server.key" -out "$cluster/data/server.crt" -days 2 -subj '/CN=arcana-test.invalid' -addext 'subjectAltName=IP:127.0.0.1' > "$cluster/cert.log" 2>&1
chmod 600 "$cluster/data/server.key"
cat > "$cluster/data/pg_hba.conf" <<'HBA'
local all all trust
hostssl all trust_user 127.0.0.1/32 trust
hostssl all md5_user 127.0.0.1/32 md5
hostssl all clear_user 127.0.0.1/32 password
hostssl all migration_test 127.0.0.1/32 scram-sha-256
host all all 0.0.0.0/0 reject
HBA
pg_ctl -D "$cluster/data" -l "$cluster/server.log" -o "-p 54481 -h 127.0.0.1 -k $cluster -c ssl=on" -w start
export MIGRATION_LIBPQ_TEST=1 MIGRATION_TEST_CA_FILE="$cluster/data/server.crt"
export MIGRATION_TEST_KEY_FILE="$cluster/data/server.key"
"$MIGRATION_PYTHON" -I mcp/test/libpq-fixture.py
npm run test:migration-libpq --prefix mcp
