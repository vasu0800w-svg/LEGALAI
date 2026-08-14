#!/usr/bin/env bash
# Create / update casemate-api on Render via API.
# Requires: RENDER_API_KEY (from https://dashboard.render.com/u/settings#api-keys)
set -euo pipefail

if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "Missing RENDER_API_KEY"
  echo "1. Open https://dashboard.render.com/u/settings#api-keys"
  echo "2. Create an API key"
  echo "3. Run: export RENDER_API_KEY=rnd_..."
  echo "4. Re-run this script"
  exit 1
fi

KEY_ID="${RAZORPAY_KEY_ID:-}"
KEY_SECRET="${RAZORPAY_KEY_SECRET:-}"

if [[ -z "$KEY_ID" || -z "$KEY_SECRET" ]]; then
  # Load from backend/.env if present
  if [[ -f "$(dirname "$0")/../.env" ]]; then
    # shellcheck disable=SC1091
    set -a
    # shellcheck source=/dev/null
    source "$(dirname "$0")/../.env"
    set +a
  fi
  KEY_ID="${RAZORPAY_KEY_ID:-}"
  KEY_SECRET="${RAZORPAY_KEY_SECRET:-}"
fi

if [[ -z "$KEY_ID" || -z "$KEY_SECRET" ]]; then
  echo "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the environment or backend/.env"
  exit 1
fi

REPO="${RENDER_REPO:-}"
OWNER="${RENDER_OWNER:-}"

echo "Listing existing services named casemate-api..."
EXISTING=$(curl -sS -H "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services?name=casemate-api&limit=1")

SERVICE_ID=$(echo "$EXISTING" | node -e '
  let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{
    try {
      const j=JSON.parse(d);
      const arr=Array.isArray(j)?j:(j.items||[]);
      const hit=(arr[0]&&(arr[0].service||arr[0]))||null;
      if(hit&&hit.id) console.log(hit.id);
    } catch(e) {}
  });
')

if [[ -n "$SERVICE_ID" ]]; then
  echo "Found service: $SERVICE_ID — triggering deploy..."
  curl -sS -X POST -H "Authorization: Bearer $RENDER_API_KEY" \
    -H "Content-Type: application/json" \
    "https://api.render.com/v1/services/$SERVICE_ID/deploys" \
    -d '{}' | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>console.log(d.slice(0,500)))'
  echo "Done. Check https://dashboard.render.com"
  exit 0
fi

if [[ -z "$REPO" ]]; then
  echo "No existing casemate-api service found."
  echo ""
  echo "Easiest path (2 minutes):"
  echo "1. Push this repo to GitHub (if not already)"
  echo "2. Open https://dashboard.render.com/select-repo?type=blueprint"
  echo "3. Select this repo (contains render.yaml)"
  echo "4. When prompted, paste:"
  echo "   RAZORPAY_KEY_ID=$KEY_ID"
  echo "   RAZORPAY_KEY_SECRET=(your secret from backend/.env)"
  echo "5. Click Apply"
  echo ""
  echo "Or create a Web Service manually:"
  echo "  Root Directory: backend"
  echo "  Build: npm install"
  echo "  Start: npm start"
  echo "  Env: RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET"
  exit 1
fi
