#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Test capture: AI DIAGNOSTICS (GIF)
# Records: streaming answer with labeled token chips (measured fact / rule
# result / ML output / hypothesis / recommendation), latency + evidence footer,
# multi-turn follow-up question, and the conversations history drawer.
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
agent-browser screenshot "$DIR/frame_000.png" > /dev/null   # KPI row + safety banner + empty chat

# fire the "Explain worst anomaly" quick action — answer streams with token chips
agent-browser find role button click --name "Explain worst anomaly" > /dev/null
sleep 2
agent-browser screenshot "$DIR/frame_001.png" > /dev/null   # streaming starts (caret visible)
sleep 4
agent-browser screenshot "$DIR/frame_002.png" > /dev/null   # answer keeps streaming
sleep 6
agent-browser screenshot "$DIR/frame_003.png" > /dev/null   # complete answer w/ labeled chips + latency

# multi-turn follow-up (proves session memory across turns)
agent-browser find role textbox click --name "Ask about devices, alerts, anomalies, telemetry" > /dev/null 2>&1 || true
agent-browser eval "var tas=document.querySelectorAll('textarea'); tas[tas.length-1].focus()" > /dev/null 2>&1 || true
agent-browser type " " "Which of those devices should an operator check first, and what command could help?" > /dev/null 2>&1 || \
  agent-browser find role textbox fill --name "Ask about devices, alerts, anomalies, telemetry" "Which of those devices should an operator check first, and what command could help?" > /dev/null 2>&1 || true
agent-browser press Enter > /dev/null
sleep 4
agent-browser screenshot "$DIR/frame_004.png" > /dev/null   # follow-up uses conversation context
sleep 6
agent-browser screenshot "$DIR/frame_005.png" > /dev/null

# open the history drawer (persisted conversations)
agent-browser find role button click --name "History" > /dev/null 2>&1 || true
sleep 2
agent-browser screenshot "$DIR/frame_006.png" > /dev/null

ffmpeg -y -loglevel error -framerate 0.9 -i "$DIR/frame_%03d.png" \
  -vf "scale=1100:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=120[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" \
  -loop 0 "$OUT"
echo "captured: $OUT ($(ls $DIR | wc -l) frames)"
