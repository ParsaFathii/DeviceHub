#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Test capture: LIVE FLEET OVERVIEW (GIF)
# Records: login → fleet overview with realtime telemetry, alerts and activity.
# Copyright © 2026 Parsa Fathi — Apache-2.0
# Usage: bash tests/gifs/capture-live-overview.sh <frames> <interval_sec>
# =============================================================================
set -u
FRAMES=${1:-16}
INTERVAL=${2:-2}
OUT="docs/assets/test-live-overview.gif"
DIR="/tmp/gif-frames/live"
rm -rf "$DIR" && mkdir -p "$DIR"

agent-browser set viewport 1440 900 > /dev/null
agent-browser open http://localhost:81 > /dev/null
agent-browser wait --load networkidle > /dev/null
sleep 2

# fresh login (frame 0: login screen)
agent-browser screenshot "$DIR/frame_000.png" > /dev/null

# login
agent-browser find role button click --name "Sign in to DeviceHub" > /dev/null
agent-browser wait --load networkidle > /dev/null
sleep 3

# capture live overview frames
i=1
while [ $i -lt $FRAMES ]; do
  sleep "$INTERVAL"
  agent-browser screenshot "$DIR/$(printf 'frame_%03d.png' $i)" > /dev/null
  i=$((i+1))
done

# assemble GIF
ffmpeg -y -loglevel error -framerate 1 -i "$DIR/frame_%03d.png" \
  -vf "scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=120[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"
echo "captured: $OUT ($(ls $DIR | wc -l) frames)"
ls -la "$OUT" | awk '{print $5" bytes"}'
