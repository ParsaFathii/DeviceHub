#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Test capture: COMMAND LIFECYCLE (GIF)
# Records: device detail → send SELF_TEST command → lifecycle stepper reaches
# SUCCEEDED via the real device acknowledgement (MQTT ack).
# Copyright © 2026 Parsa Fathi — Apache-2.0
# Usage: bash tests/gifs/capture-command-lifecycle.sh
# =============================================================================
set -u
OUT="docs/assets/test-command-lifecycle.gif"
DIR="/tmp/gif-frames/command"
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

# open Devices view → device detail
agent-browser find role button click --name "Devices" > /dev/null
sleep 3
agent-browser find role cell click --name "DH-VIB-002" > /dev/null 2>&1 || agent-browser find text "Vibration Sensor 002" click > /dev/null 2>&1 || true
sleep 3
agent-browser screenshot "$DIR/frame_000.png" > /dev/null

# open send-command dialog
agent-browser find role button click --name "Send Command" > /dev/null
sleep 1.5
agent-browser screenshot "$DIR/frame_001.png" > /dev/null

# dispatch SELF_TEST
agent-browser find role button click --name "Dispatch Command" > /dev/null
sleep 2
agent-browser screenshot "$DIR/frame_002.png" > /dev/null

# go to Commands & Audit and watch the lifecycle stepper
agent-browser find role button click --name "Commands & Audit" > /dev/null
sleep 2
agent-browser screenshot "$DIR/frame_003.png" > /dev/null
# capture the stepper evolving to SUCCEEDED with ack detail
sleep 2
agent-browser screenshot "$DIR/frame_004.png" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_005.png" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_006.png" > /dev/null

ffmpeg -y -loglevel error -framerate 0.9 -i "$DIR/frame_%03d.png" \
  -vf "scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=120[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"
echo "captured: $OUT ($(ls $DIR | wc -l) frames)"
