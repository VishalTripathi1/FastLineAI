#!/bin/bash
# =============================================================================
# FirstLineAI — One-command startup script
# Starts: Cloudflare tunnel → updates PUBLIC_BASE_URL → outbound backend → frontend
# Usage: ./start.sh
# =============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTBOUND_DIR="$PROJECT_DIR/outbound"
FRONTEND_DIR="$PROJECT_DIR/frontend"
ENV_FILE="$OUTBOUND_DIR/.env"
FRONTEND_ENV="$FRONTEND_DIR/.env.local"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Track PIDs for cleanup
TUNNEL_PID=""
OUTBOUND_PID=""
FRONTEND_PID=""

cleanup() {
    echo ""
    echo -e "${YELLOW}🛑 Shutting down all services...${NC}"
    [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null && echo "  ↳ Cloudflare tunnel stopped"
    [ -n "$OUTBOUND_PID" ] && kill "$OUTBOUND_PID" 2>/dev/null && echo "  ↳ Outbound backend stopped"
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null && echo "  ↳ Frontend stopped"
    wait 2>/dev/null
    echo -e "${GREEN}✅ All services stopped. Goodbye!${NC}"
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo -e "${BOLD}"
echo "  _____ _         _   _     _              _    ___ "
echo " |  ___(_)_ __ __| |_| |   (_)_ __   ___  / \  |_ _|"
echo " | |_  | | '__/ __| __| |   | | '_ \ / _ \/ _ \  | | "
echo " |  _| | | |  \__ \ |_| |___| | | | |  __/ ___ \ | | "
echo " |_|   |_|_|  |___/\__|_____|_|_| |_|\___/_/   \_\___|"
echo -e "${NC}"
echo ""

# ─── Step 1: Start Cloudflare tunnel ─────────────────────────────────────────
echo -e "${BLUE}[1/4]${NC} Starting Cloudflare tunnel to expose port 8000..."

TUNNEL_LOG=$(mktemp)
npx -y cloudflared tunnel --url http://localhost:8000 > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for the tunnel URL to appear in the logs (up to 30 seconds)
TUNNEL_URL=""
for i in $(seq 1 30); do
    TUNNEL_URL=$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    if [ -n "$TUNNEL_URL" ]; then
        break
    fi
    sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
    echo -e "${RED}✗ Failed to get tunnel URL after 30 seconds. Check your internet connection.${NC}"
    exit 1
fi

echo -e "${GREEN}  ✓ Tunnel active: ${BOLD}$TUNNEL_URL${NC}"

# ─── Step 2: Update .env files ───────────────────────────────────────────────
echo -e "${BLUE}[2/4]${NC} Updating environment configuration..."

# Update PUBLIC_BASE_URL in outbound/.env
if [ -f "$ENV_FILE" ]; then
    # Use sed to replace the PUBLIC_BASE_URL line (macOS compatible)
    sed -i '' "s|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=$TUNNEL_URL|" "$ENV_FILE"
    echo -e "${GREEN}  ✓ outbound/.env → PUBLIC_BASE_URL=${TUNNEL_URL}${NC}"
else
    echo -e "${RED}  ✗ outbound/.env not found!${NC}"
    exit 1
fi

# Ensure frontend/.env.local points to localhost backend
if [ -f "$FRONTEND_ENV" ]; then
    sed -i '' "s|^OUTBOUND_CALL_API_URL=.*|OUTBOUND_CALL_API_URL=http://localhost:8000|" "$FRONTEND_ENV"
else
    echo "# Outbound service URL (local dev)" > "$FRONTEND_ENV"
    echo "OUTBOUND_CALL_API_URL=http://localhost:8000" >> "$FRONTEND_ENV"
fi
echo -e "${GREEN}  ✓ frontend/.env.local → OUTBOUND_CALL_API_URL=http://localhost:8000${NC}"

# ─── Step 3: Start outbound backend ──────────────────────────────────────────
echo -e "${BLUE}[3/4]${NC} Starting outbound backend on port 8000..."
cd "$OUTBOUND_DIR"
node outbound.js &
OUTBOUND_PID=$!
sleep 2

# Verify backend is running
if curl -s http://localhost:8000/ > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ Outbound backend is running${NC}"
else
    echo -e "${RED}  ✗ Outbound backend failed to start!${NC}"
    exit 1
fi

# ─── Step 4: Start frontend ──────────────────────────────────────────────────
echo -e "${BLUE}[4/4]${NC} Starting frontend on port 3000..."
cd "$FRONTEND_DIR"
npm run dev &
FRONTEND_PID=$!
sleep 3

# ─── Ready ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  🚀 FirstLineAI is ready!${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Frontend:${NC}        http://localhost:3000"
echo -e "  ${BOLD}Outbound API:${NC}    http://localhost:8000"
echo -e "  ${BOLD}Tunnel (Twilio):${NC} $TUNNEL_URL"
echo ""
echo -e "  ${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# Keep the script running until interrupted
wait
