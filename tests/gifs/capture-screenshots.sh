#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Screenshot capture: all 11 views (full-page PNG to docs/assets/)
# Copyright © 2026 Parsa Fathi — Apache-2.0
# Usage: bash tests/gifs/capture-screenshots.sh
# =============================================================================
set -u
OUTDIR="docs/assets"
getref() { rg -o 'ref=e[0-9]+' | head -1 | sed 's/ref=/@/'; }

agent-browser set viewport 1440 900 > /dev/null
agent-browser open http://localhost:81 > /dev/null
agent-browser wait --load networkidle > /dev/null
sleep 2

if agent-browser snapshot -i 2>/dev/null | rg -q "Sign in to DeviceHub"; then
  agent-browser find role button click --name "Sign in to DeviceHub" > /dev/null
  agent-browser wait --load networkidle > /dev/null
  sleep 4
fi

shot() { # shot <view-button-name> <filename> <settle-sec>
  agent-browser find role button click --name "$1" > /dev/null
  sleep "${3:-4}"
  agent-browser screenshot --full "$OUTDIR/$2" > /dev/null
  echo "captured $2"
}

# 1. overview (wait for rings to animate + live data)
agent-browser find role button click --name "Fleet Overview" > /dev/null
sleep 5
agent-browser screenshot --full "$OUTDIR/overview.png" > /dev/null
echo "captured overview.png"

# 2. devices
shot "Devices" "devices.png" 4

# 3. device detail (open the drift-anomaly device)
agent-browser find role cell click --name "DH-ENV-003" > /dev/null 2>&1 || agent-browser find text "Environmental Sensor 003" click > /dev/null 2>&1 || true
sleep 5
agent-browser screenshot --full "$OUTDIR/device-detail.png" > /dev/null
echo "captured device-detail.png"
agent-browser find role button click --name "Back to devices" > /dev/null
sleep 2

# 4. gateways
shot "Gateways" "gateways.png" 5

# 5. telemetry explorer
shot "Telemetry Explorer" "telemetry-explorer.png" 5

# 6. automation
shot "Automation Rules" "automation.png" 4

# 7. alerts
shot "Alerts" "alerts.png" 4

# 8. anomaly analysis
shot "Anomaly Analysis" "anomaly.png" 4

# 9. commands & audit
shot "Commands & Audit" "commands-audit.png" 4

# 10. AI diagnostics — ask a real question first so the answer + chips are visible
agent-browser find role button click --name "AI Diagnostics" > /dev/null
sleep 3
agent-browser find role button click --name "Explain worst anomaly" > /dev/null
sleep 12
agent-browser screenshot --full "$OUTDIR/ai-diagnostics.png" > /dev/null
echo "captured ai-diagnostics.png"

# 11. settings
shot "Settings" "settings.png" 4

echo "ALL SCREENSHOTS DONE"
