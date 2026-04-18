#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# KrwnOS — one-command installer (Pro tier: self-hosted VPS / home server).
#
#   curl -sSL get.krwnos.com | bash
#
# Prerequisites: linux, docker 24+, docker compose v2, curl, git.
# -----------------------------------------------------------------------------
set -euo pipefail

KRWN_REPO="${KRWN_REPO:-https://github.com/KrwnOS/krwnos.git}"
KRWN_DIR="${KRWN_DIR:-$HOME/.krwnos}"
KRWN_REF="${KRWN_REF:-main}"
KRWN_PORT="${KRWN_PORT:-3000}"
KRWN_TUNNEL="${KRWN_TUNNEL:-}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
info() { printf "  \033[36m▸\033[0m %s\n" "$*"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$*" >&2; exit 1; }

require() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required binary: $1"
}

bold "KrwnOS installer — Pro tier"
require docker
require git
require openssl

if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose v2 is required (check: docker compose version)"
fi

if [ -d "$KRWN_DIR/.git" ]; then
  info "Updating existing checkout at $KRWN_DIR"
  git -C "$KRWN_DIR" fetch --depth=1 origin "$KRWN_REF"
  git -C "$KRWN_DIR" reset --hard "origin/$KRWN_REF"
else
  info "Cloning KrwnOS → $KRWN_DIR"
  git clone --depth=1 --branch "$KRWN_REF" "$KRWN_REPO" "$KRWN_DIR"
fi

cd "$KRWN_DIR/deploy"

if [ ! -f .env ]; then
  info "Generating deploy/.env"
  secret=$(openssl rand -hex 32)
  cat > .env <<EOF
AUTH_SECRET=$secret
AUTH_URL=http://localhost:${KRWN_PORT}
APP_URL=http://localhost:${KRWN_PORT}
POSTGRES_USER=krwn
POSTGRES_PASSWORD=krwn
POSTGRES_DB=krwnos
KRWN_PORT=${KRWN_PORT}
KRWN_TIER=pro
KRWN_VERSION=0.1.0
CLOUDFLARE_TUNNEL_TOKEN=${KRWN_TUNNEL}
EOF
fi

info "Building containers"
docker compose build --pull

info "Running migrations"
docker compose run --rm app npx prisma migrate deploy

info "Starting services"
if [ -n "$KRWN_TUNNEL" ]; then
  docker compose --profile tunnel up -d
else
  docker compose up -d
fi

info "Bootstrapping Sovereign (interactive)"
docker compose exec app npm run setup || true

bold "✓ KrwnOS is live"
echo
echo "   local:    http://localhost:${KRWN_PORT}"
if [ -n "$KRWN_TUNNEL" ]; then
  echo "   tunnel:   active (cloudflared)"
fi
echo
echo "   Next steps:"
echo "     1. Save the CLI token printed by the setup wizard above."
echo "     2. Run: krwn login --host http://localhost:${KRWN_PORT} --token <raw>"
echo "     3. Install your first module: krwn module install core.chat"
