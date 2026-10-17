#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Test capture: AI DIAGNOSTICS (GIF)
# Records: evidence-grounded question → answer with labeled facts + evidence
# summary footer (advisory-only assistant).
# Copyright © 2026 Parsa Fathi — Apache-2.0
# Usage: bash tests/gifs/capture-ai-diagnostics.sh
# =============================================================================
set -u
OUT="docs/assets/test-ai-diagnostics.gif"
DIR="/tmp/gif-frames/ai"
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

agent-browser find role button click --name "AI Diagnostics" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_000.png" > /dev/null

# click a suggested question
agent-browser find role button click --name "Explain the temperature anomaly on DH-ENV-003" > /dev/null
sleep 1
agent-browser screenshot "$DIR/frame_001.png" > /dev/null

# ask
agent-browser find role button click --name "Ask" > /dev/null
sleep 3
agent-browser screenshot "$DIR/frame_002.png" > /dev/null

# wait for the evidence-grounded answer to stream in
for i in 3 4 5 6; do
  sleep 5
  agent-browser screenshot "$DIR/$(printf 'frame_%03d.png' $i)" > /dev/null
done

ffmpeg -y -loglevel error -framerate 0.9 -i "$DIR/frame_%03d.png" \
  -vf "scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=120[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"
echo "captured: $OUT ($(ls $DIR | wc -l) frames)"
