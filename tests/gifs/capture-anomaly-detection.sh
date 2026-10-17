#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Test capture: ANOMALY DETECTION (GIF)
# Records: Run Detection (IsolationForest + baseline over stored telemetry) →
# findings list with scores + evidence labels; Run Evaluation → real metrics.
# Copyright © 2026 Parsa Fathi — Apache-2.0
# Usage: bash tests/gifs/capture-anomaly-detection.sh
# =============================================================================
set -u
OUT="docs/assets/test-anomaly-detection.gif"
DIR="/tmp/gif-frames/anomaly"
rm -rf "$DIR" && mkdir -p "$DIR"

agent-browser set viewport 1440 900 > /dev/null
agent-browser open http://localhost:81 > /dev/null
agent-browser wait --load networkidle > /dev/null
sleep 2

if agent-browser snapshot -i 2>/dev/null | rg -q "Sign in to DeviceHub"; then
  agent-browser find role button click --name "Sign in to DeviceHub" > /dev/null
  agent-browser wait --load networkidle > /dev/null
  sleep 3
fi

agent-browser find role button click --name "Anomaly Analysis" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_000.png" > /dev/null

# run detection
agent-browser find role button click --name "Run Detection" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_001.png" > /dev/null
sleep 4
agent-browser screenshot "$DIR/frame_002.png" > /dev/null

# scroll to show findings
agent-browser scroll down 500 > /dev/null
sleep 1
agent-browser screenshot "$DIR/frame_003.png" > /dev/null

# run evaluation (labeled dataset, real metrics)
agent-browser find role button click --name "Run Evaluation" > /dev/null
sleep 5
agent-browser screenshot "$DIR/frame_004.png" > /dev/null
agent-browser scroll down 400 > /dev/null
sleep 4
agent-browser screenshot "$DIR/frame_005.png" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_006.png" > /dev/null

ffmpeg -y -loglevel error -framerate 0.9 -i "$DIR/frame_%03d.png" \
  -vf "scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=120[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"
echo "captured: $OUT ($(ls $DIR | wc -l) frames)"
