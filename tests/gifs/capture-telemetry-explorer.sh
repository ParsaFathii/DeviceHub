#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Test capture: TELEMETRY EXPLORER (GIF)
# Records: device selector → threshold-violation device, time range change,
# threshold overlay + aggregation table on real stored telemetry.
# Copyright © 2026 Parsa Fathi — Apache-2.0
# Usage: bash tests/gifs/capture-telemetry-explorer.sh
# =============================================================================
set -u
OUT="docs/assets/test-telemetry-explorer.gif"
DIR="/tmp/gif-frames/telemetry"
rm -rf "$DIR" && mkdir -p "$DIR"

# helper: extract @ref from a snapshot line like "combobox [expanded=false, ref=e40]: text"
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

agent-browser find role button click --name "Telemetry Explorer" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_000.png" > /dev/null

# open device combobox (first combobox)
DEV_REF=$(agent-browser snapshot -i 2>/dev/null | rg "combobox" | head -1 | getref)
echo "device ref: $DEV_REF"
agent-browser click "$DEV_REF" > /dev/null
sleep 1.5
agent-browser find role option click --name "DH-ENV-003 — Environmental Sensor 003" > /dev/null && echo "device selected"
sleep 3.5
agent-browser screenshot "$DIR/frame_001.png" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_002.png" > /dev/null

# switch time range to 3 hours (3rd combobox)
RANGE_REF=$(agent-browser snapshot -i 2>/dev/null | rg "combobox" | sed -n 3p | getref)
echo "range ref: $RANGE_REF"
agent-browser click "$RANGE_REF" > /dev/null
sleep 1.5
agent-browser find role option click --name "Last 3 hours" > /dev/null && echo "range selected"
sleep 3.5
agent-browser screenshot "$DIR/frame_003.png" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_004.png" > /dev/null

ffmpeg -y -loglevel error -framerate 0.8 -i "$DIR/frame_%03d.png" \
  -vf "scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=120[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"
echo "captured: $OUT ($(ls $DIR | wc -l) frames)"
