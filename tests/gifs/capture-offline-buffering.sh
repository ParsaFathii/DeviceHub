#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Test capture: OFFLINE BUFFERING / FAILURE INJECTION (GIF)
# Records: gateways view → 90s backend outage injected → edge gateway switches
# to BUFFERING, telemetry spools locally (pending count grows) → outage ends →
# automatic drain → spool empty + DRAINED lifecycle event + platform recovers.
# Copyright © 2026 Parsa Fathi — Apache-2.0
# Usage: bash tests/gifs/capture-offline-buffering.sh
# =============================================================================
set -u
OUT="docs/assets/test-offline-buffering.gif"
DIR="/tmp/gif-frames/buffer"
rm -rf "$DIR" && mkdir -p "$DIR"
getref() { rg -o 'ref=e[0-9]+' | head -1 | sed 's/ref=/@/'; }

agent-browser set viewport 1440 900 > /dev/null
agent-browser open http://localhost:81 > /dev/null
agent-browser wait --load networkidle > /dev/null
sleep 2

if agent-browser snapshot -i 2>/dev/null | rg -q "Sign in to DeviceHub"; then
  agent-browser find role button click --name "Sign in to DeviceHub" > /dev/null
  agent-browser wait --load networkidle > /dev/null
  sleep 3
fi

agent-browser find role button click --name "Gateways" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_000.png" > /dev/null   # healthy gateway, empty spool

# speed up two devices so the buffer grows visibly
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/commands -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"SET_INTERVAL","payload":{"intervalSec":2}}' > /dev/null
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/commands -H 'content-type: application/json' -d '{"deviceId":"DH-PWR-001","action":"SET_INTERVAL","payload":{"intervalSec":2}}' > /dev/null
sleep 3

# ---- inject the backend outage (90s) ----
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/gateways/edge-gw-01/outage -H 'content-type: application/json' -d '{"seconds":90}' > /dev/null
echo "outage injected"
sleep 3
agent-browser screenshot "$DIR/frame_001.png" > /dev/null   # BUFFERING banner appears

# capture the spool growing during the outage
for i in 2 3 4 5 6 7 8; do
  sleep 9
  agent-browser screenshot "$DIR/$(printf 'frame_%03d.png' $i)" > /dev/null
done

# ---- outage ends → automatic drain ----
echo "waiting for drain…"
for i in 9 10 11 12 13 14; do
  sleep 8
  agent-browser screenshot "$DIR/$(printf 'frame_%03d.png' $i)" > /dev/null
done

# restore device intervals
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/commands -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"SET_INTERVAL","payload":{"intervalSec":5}}' > /dev/null
curl -s -b /tmp/cookies.txt -X POST http://localhost:3000/api/commands -H 'content-type: application/json' -d '{"deviceId":"DH-PWR-001","action":"SET_INTERVAL","payload":{"intervalSec":5}}' > /dev/null

ffmpeg -y -loglevel error -framerate 0.85 -i "$DIR/frame_%03d.png" \
  -vf "scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=120[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"
echo "captured: $OUT ($(ls $DIR | wc -l) frames)"
