#!/usr/bin/env bash
# Disposable PostgreSQL17 TLS fixture; no external database credentials.
set -euo pipefail
: "${MIGRATION_PYTHON:?Set the reviewed Python interpreter}"
cluster=$(mktemp -d "${TMPDIR:-/tmp}/arcana-libpq-docker.XXXXXX")
container="arcana-libpq-$(basename "$cluster")"
trap 'docker stop "$container" >/dev/null 2>&1 || true' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$cluster/server.key" -out "$cluster/server.crt" -days 2 -subj '/CN=arcana-test.invalid' -addext 'subjectAltName=IP:127.0.0.1' > "$cluster/cert.log" 2>&1
cat > "$cluster/pg_hba.conf" <<'HBA'
local all all trust
hostssl all trust_user 0.0.0.0/0 trust
hostssl all md5_user 0.0.0.0/0 md5
hostssl all clear_user 0.0.0.0/0 password
hostssl all migration_test 0.0.0.0/0 scram-sha-256
host all all 0.0.0.0/0 reject
HBA
docker run --rm -d --name "$container" -p 127.0.0.1:54481:5432 \
  -v "$cluster:/fixture:ro" -e POSTGRES_USER=migration_test \
  -e POSTGRES_PASSWORD=local-test-only -e POSTGRES_DB=postgres \
  --entrypoint bash postgres:17 -ec '
    cp /fixture/server.key /tmp/server.key
    cp /fixture/server.crt /tmp/server.crt
    cp /fixture/pg_hba.conf /tmp/pg_hba.conf
    chown postgres:postgres /tmp/server.key
    chmod 600 /tmp/server.key
    exec docker-entrypoint.sh postgres -c ssl=on -c ssl_key_file=/tmp/server.key -c ssl_cert_file=/tmp/server.crt -c hba_file=/tmp/pg_hba.conf
  '
ready=false
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U migration_test >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then docker logs "$container"; exit 1; fi
export MIGRATION_LIBPQ_TEST=1 MIGRATION_TEST_CA_FILE="$cluster/server.crt" MIGRATION_TEST_KEY_FILE="$cluster/server.key"
"$MIGRATION_PYTHON" -I mcp/test/libpq-fixture.py
npm run test:migration-libpq --prefix mcp

if [[ "$POSTGRES_VERSION" == 18 ]]; then
  (cd mcp && ARCANA_RECONCILIATION_PG18_TEST=1 node --import tsx test/production-reconciliation.ts)
fi
