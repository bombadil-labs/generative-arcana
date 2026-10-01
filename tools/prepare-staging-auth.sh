#!/usr/bin/env bash
# WSL/Linux operator helper. Prompts locally; never applies migrations or changes Vercel.
set +x +v
set -euo pipefail
umask 077
if [[ $# -ne 1 || "$1" != https://* ]]; then
  printf 'Usage: bash tools/prepare-staging-auth.sh https://STABLE-PREVIEW-HOST\n' >&2
  exit 1
fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
if [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  printf 'Use Node.js 24 before running this helper.\n' >&2
  exit 1
fi
[[ -t 0 ]] || { printf 'Run in an interactive terminal so the secret prompt stays local.\n' >&2; exit 1; }
# Install before reading the secret so dependency lifecycle scripts cannot inherit it.
env -u ARCANA_STAGING_DATABASE_URL -u DATABASE_URL -u BETTER_AUTH_DATABASE_URL -u DATABASE_MIGRATION_URL npm ci --prefix mcp
printf '\nUse the unpooled/direct connection for the same new, isolated Neon branch as this feature branch’s Preview deployment.\n'
printf 'Do not use the old production database or another project. This helper is read-only.\n'
IFS= read -r -s -p 'Paste the staging Neon unpooled connection URL (hidden): ' ARCANA_STAGING_DATABASE_URL
printf '\n'
trap 'unset ARCANA_STAGING_DATABASE_URL' EXIT
plan_dir=$(mktemp -d "${HOME}/arcana-staging-plan.XXXXXX")
plan_path="$plan_dir/auth-plan.json"
cd "$root/mcp"
status=0
ARCANA_STAGING_DATABASE_URL="$ARCANA_STAGING_DATABASE_URL" node --import tsx scripts/staging-preflight.ts --origin "$1" --out "$plan_path" || status=$?
if [[ -f "$plan_path" ]]; then printf '\nPrivate plan: %s\n' "$plan_path"; fi
if [[ "$status" -ne 0 ]]; then
  printf 'Preflight did not pass. Keep any plan private and review the reported problem; no migration was applied.\n' >&2
  exit "$status"
fi
printf 'Review the target summary and both this plan and mcp/migrations/001-domain.sql. Stop here for target/migration approval.\n'
