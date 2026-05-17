#!/usr/bin/env zsh
# ═════════════════════════════════════════════════════════════
# deploy.sh — Push modificări și purjează cache jsDelivr
# ═════════════════════════════════════════════════════════════
#
# ── SINTAXĂ ──────────────────────────────────────────────────
#
#   ./deploy.sh "<mesaj commit>" [fisier1] [fisier2] ...
#
#   Dacă nu specifici fișiere → face git add -A (tot repo-ul)
#   Dacă specifici fișiere   → face git add doar pe acelea
#
# ── EXEMPLE ──────────────────────────────────────────────────
#
# » Toate fișierele modificate din repo:
#       ./deploy.sh "fix: checkout tracking"
#
# » Doar scriptul principal (cel mai comun — actualizează CDN):
#       ./deploy.sh "fix: add checkout-ds24.com domain" app-core.js
#
# » Doar templateurile de upsell (nu afectează CDN):
#       ./deploy.sh "update: upsell templates" upsell-code-leadpages.html upsell-code-chechoutChamp.html
#
# » Doar acest script de deploy:
#       ./deploy.sh "chore: update deploy script" deploy.sh
#
# » Mai multe fișiere mixte:
#       ./deploy.sh "fix: tracking + templates" app-core.js upsell-code-leadpages.html
#
# » Fișiere din subfoldere (cale relativă față de rădăcina repo-ului):
#       ./deploy.sh "chore: update sql scripts" analytics-queries.sql azure-database-schema.sql
#
# ── CE FACE ──────────────────────────────────────────────────
#
#   1. git add (toate sau specifice) + commit + push pe main
#   2. Purjează cache-ul jsDelivr pentru app-core.js
#      → toate domeniile cu @main primesc versiunea nouă în ~1-2 min
#   3. Verifică că fișierul e accesibil pe CDN
#
# NOTĂ: Purge-ul jsDelivr se face MEREU pentru app-core.js,
#       indiferent ce fișiere ai modificat în commit.
#       Dacă nu ai modificat app-core.js, purge-ul e inofensiv.
#
# ═════════════════════════════════════════════════════════════

set -e

REPO="GlobalBrother/user-journey-tracker"
FILE="app-core.js"
BRANCH="main"

CDN_URL="https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${FILE}"
PURGE_URL="https://purge.jsdelivr.net/gh/${REPO}@${BRANCH}/${FILE}"
DASHBOARD_PURGE_URL="https://purge.jsdelivr.net/gh/${REPO}@${BRANCH}/dashboard.html"
REPO_DIR="$(dirname "$0")"

# ── 1. Git commit & push ──────────────────────────────────────
COMMIT_MSG="${1:-update}"
shift  # elimină primul argument (mesajul), restul sunt fișierele

echo "📦 Commit & push..."
if [[ $# -eq 0 ]]; then
  echo "  (adăugând toate fișierele modificate)"
  git -C "$REPO_DIR" add -A
else
  echo "  (adăugând: $*)"
  git -C "$REPO_DIR" add -- "$@"
fi
git -C "$REPO_DIR" commit -m "$COMMIT_MSG" || echo "  (nothing new to commit)"
git -C "$REPO_DIR" push origin "$BRANCH"
echo "  ✅ Push OK"

HEAD_SHA=$(git -C "$REPO_DIR" rev-parse --short HEAD)
SHA_CDN_URL="https://cdn.jsdelivr.net/gh/${REPO}@${HEAD_SHA}/${FILE}"
RAW_SHA_URL="https://raw.githubusercontent.com/${REPO}/${HEAD_SHA}/${FILE}"

# ── 2. Purjează cache jsDelivr ────────────────────────────────
echo ""
echo "🧹 Purging jsDelivr cache..."
PURGE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$PURGE_URL")

if [[ "$PURGE_RESPONSE" == "200" ]]; then
  echo "  ✅ app-core.js cache purged (HTTP 200)"
else
  echo "  ⚠️  app-core.js purge response: HTTP $PURGE_RESPONSE"
fi

DASH_PURGE_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$DASHBOARD_PURGE_URL")
if [[ "$DASH_PURGE_RESPONSE" == "200" ]]; then
  echo "  ✅ dashboard.html cache purged (HTTP 200)"
else
  echo "  ⚠️  dashboard.html purge response: HTTP $DASH_PURGE_RESPONSE"
  echo "  Poți purja manual la: https://www.jsdelivr.com/tools/purge"
fi

# ── 3. Verifică că fișierul e accesibil ──────────────────────
echo ""
echo "🔍 Verificare CDN (@main vs commit)..."

_hash_of_url() {
  local url="$1"
  curl -fsSL "$url" | shasum -a 256 | awk '{print $1}'
}

MAX_RETRIES=10
SLEEP_SECS=8
SUCCESS=0

for ((i=1; i<=MAX_RETRIES; i++)); do
  RAW_HASH=$(_hash_of_url "$RAW_SHA_URL" || true)
  MAIN_HASH=$(_hash_of_url "$CDN_URL" || true)
  SHA_HASH=$(_hash_of_url "$SHA_CDN_URL" || true)

  if [[ -n "$RAW_HASH" && "$RAW_HASH" == "$MAIN_HASH" ]]; then
    echo "  ✅ jsDelivr @main este sincronizat cu commit $HEAD_SHA"
    SUCCESS=1
    break
  fi

  echo "  ⏳ Încercare $i/$MAX_RETRIES: @main încă nu e sincronizat"
  if [[ -n "$SHA_HASH" && "$RAW_HASH" == "$SHA_HASH" ]]; then
    echo "     - commit URL este deja corect: $SHA_CDN_URL"
  fi

  # Re-trigger purge while waiting for branch cache refresh
  curl -s -o /dev/null "$PURGE_URL" || true
  sleep "$SLEEP_SECS"
done

if [[ "$SUCCESS" != "1" ]]; then
  echo "  ⚠️  @main încă nu s-a aliniat după $MAX_RETRIES încercări."
  echo "     Folosește temporar commit URL (fără ghicit):"
  echo "     $SHA_CDN_URL"
fi

echo ""
echo "🎉 Done!"
