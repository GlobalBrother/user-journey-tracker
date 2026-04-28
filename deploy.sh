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

# ── 1. Git commit & push ──────────────────────────────────────
COMMIT_MSG="${1:-update}"
shift  # elimină primul argument (mesajul), restul sunt fișierele

echo "📦 Commit & push..."
if [[ $# -eq 0 ]]; then
  echo "  (adăugând toate fișierele modificate)"
  git -C "$(dirname "$0")" add -A
else
  echo "  (adăugând: $*)"
  git -C "$(dirname "$0")" add -- "$@"
fi
git -C "$(dirname "$0")" commit -m "$COMMIT_MSG" || echo "  (nothing new to commit)"
git -C "$(dirname "$0")" push origin "$BRANCH"
echo "  ✅ Push OK"

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
echo "🔍 Verificare CDN..."
sleep 3
CDN_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$CDN_URL")

if [[ "$CDN_STATUS" == "200" ]]; then
  echo "  ✅ Fișierul e live: $CDN_URL"
else
  echo "  ⚠️  CDN status: HTTP $CDN_STATUS — mai așteaptă 1-2 minute"
fi

echo ""
echo "🎉 Done! Toate domeniile cu @main vor primi versiunea nouă în ~1-2 minute."
