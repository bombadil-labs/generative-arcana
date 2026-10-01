#!/usr/bin/env bash
# WSL/Linux operator helper. Read-only production review; no apply or deployment.
set +x +v
set -euo pipefail
umask 077
if [[ $# -ne 1 || "$1" != https://* ]]; then
  printf 'Usage: bash tools/prepare-production-auth.sh https://PRODUCTION-HOST\n' >&2
  exit 1
fi
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
[[ -t 0 ]] || { printf 'Run in an interactive terminal so the secret prompt stays local.\n' >&2; exit 1; }
# Clear inherited DB/PG/auth/mail/NODE_OPTIONS overrides before installation or secret entry.
# The prompted URL is passed only in the node process environment, never as an argument.
env -i PATH="$PATH" HOME="$HOME" bash --noprofile --norc -s -- "$root" "$1" <<'OPERATOR'
set +x +v
set -euo pipefail
umask 077
cd "$1"
[[ $(node -p 'process.versions.node.split(".")[0]') == 24 ]] || { printf 'Use Node.js 24 before running this helper.\n' >&2; exit 1; }
# Install before reading the secret so dependency lifecycle scripts cannot inherit it.
npm ci --prefix mcp
printf '\nUse the unpooled/direct connection for the exact effective Production auth database.\n'
printf 'Check Vercel Production DATABASE_URL and any BETTER_AUTH_DATABASE_URL override against the intended Neon project/branch. This helper is read-only.\n'
trap 'unset ARCANA_PRODUCTION_DATABASE_URL' EXIT
IFS= read -r -s -p 'Paste the production Neon unpooled connection URL (hidden): ' ARCANA_PRODUCTION_DATABASE_URL </dev/tty
printf '\n'
plan_dir=$(mktemp -d "${HOME}/arcana-production-plan.XXXXXX")
plan_path="$plan_dir/auth-plan.json"
cd mcp
status=0
ARCANA_PRODUCTION_DATABASE_URL="$ARCANA_PRODUCTION_DATABASE_URL" node --import tsx scripts/staging-preflight.ts --target production --origin "$2" --out "$plan_path" || status=$?
if [[ -f "$plan_path" ]]; then printf '\nPrivate production plan: %s\n' "$plan_path"; fi
if [[ "$status" -ne 0 ]]; then
  printf 'Production preflight did not pass. Keep any plan private and review the reported problem; no migration was applied.\n' >&2
  exit "$status"
fi
printf 'Review the production target, this auth plan, and mcp/migrations/001-domain.sql separately. Stop for target/migration approval and a verified restore point before any production apply.\n'
OPERATOR
