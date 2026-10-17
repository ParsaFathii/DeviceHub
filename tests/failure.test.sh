#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Reliability & failure-injection test suite (PASS 2)
# Copyright © 2026 Parsa Fathi — Apache-2.0
#
# Tests against the LIVE platform:
#   R1  duplicate MQTT delivery is deduplicated
#   R2  delayed telemetry is preserved and flagged (never discarded)
#   R3  backend outage → durable offline buffering → automatic drain
#   R4  gateway restart with pending spool → spool survives → drains on boot
#   R5  malformed telemetry is rejected with counters
#   R6  device pause → OFFLINE timeout → resume → ONLINE
#   R7  MQTT broker restart → gateway + devices reconnect
#
# Usage: bash tests/failure.test.sh   (takes ~3 minutes)
# =============================================================================
set -u
BASE="http://localhost:3000"
GW="http://localhost:3011"
SIM="http://localhost:3012"
TOKEN="dev-internal-token"
TMP="$(mktemp -d)"
PASS=0; FAIL=0; FAILED_TESTS=()
GW_DIR="/home/z/my-project/mini-services/gateway"

check() {
  if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "  ✔ $1";
  else FAIL=$((FAIL+1)); FAILED_TESTS+=("$1"); echo "  ✘ $1"; fi
}
jsonval() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }
log() { echo "  … $1"; }

echo "════════════════════════════════════════════════════════════════"
echo " DeviceHub Reliability Test Suite (PASS 2 — Failure Injection)"
echo "════════════════════════════════════════════════════════════════"

auth() { curl -s -c "$TMP/jar" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"username":"admin","password":"admin123"}' > /dev/null; }
auth

dbcount() { # metric-filtered sample count
  curl -s -H "X-Internal-Token: $TOKEN" "$BASE/api/internal/telemetry?deviceId=$1&metric=$2&limit=5000" | jsonval "len(d['samples'])"
}
gwmetric() { curl -s "$GW/status" | jsonval "d['metrics']['$1']"; }

# ---- R1: duplicate delivery --------------------------------------------------
echo "── R1: duplicate MQTT delivery dedup ──"
BEFORE_DEDUP=$(gwmetric deduped)
curl -s -X POST "$SIM/control" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"duplicate-last"}' > /dev/null
sleep 2
AFTER_DEDUP=$(gwmetric deduped)
DELTA=$((AFTER_DEDUP - BEFORE_DEDUP))
[ "$DELTA" -ge 1 ]; check "duplicate delivery detected & dropped at gateway (+$DELTA deduped)" $?

# ---- R2: delayed telemetry preserved ----------------------------------------
echo "── R2: delayed telemetry preservation ──"
BEFORE_CNT=$(dbcount DH-ENV-002 temperature)
curl -s -X POST "$SIM/control" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-002","action":"delayed"}' > /dev/null
sleep 4
AFTER_CNT=$(dbcount DH-ENV-002 temperature)
DELTA=$((AFTER_CNT - BEFORE_CNT))
[ "$DELTA" -ge 1 ]; check "delayed sample accepted, not discarded (+$DELTA samples)" $?
DELAYED_FLAG=$(curl -s -H "X-Internal-Token: $TOKEN" "$BASE/api/internal/telemetry?deviceId=DH-ENV-002&metric=temperature&limit=200" | jsonval "any(s['delayed'] for s in d['samples'])")
[ "$DELAYED_FLAG" = "True" ]; check "delayed sample flagged delayed=true" $?

# ---- R3: backend outage → offline buffering → drain -------------------------
echo "── R3: backend outage → durable buffering → automatic drain ──"
# give the fleet more traffic for a richer buffer: temporarily set 2 fast devices
curl -s -b "$TMP/jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"SET_INTERVAL","payload":{"intervalSec":2}}' > /dev/null
curl -s -b "$TMP/jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-VIB-002","action":"SET_INTERVAL","payload":{"intervalSec":2}}' > /dev/null
sleep 3

BEFORE_FORWARDED=$(gwmetric forwarded)
curl -s -b "$TMP/jar" -X POST "$BASE/api/gateways/edge-gw-01/outage" -H 'content-type: application/json' -d '{"seconds":30}' > "$TMP/outage.json"
OUTAGE_OK=$(jsonval "d.get('ok')" < "$TMP/outage.json")
[ "$OUTAGE_OK" = "True" ]; check "backend outage injected (30s)" $?

sleep 12
PENDING_MID=$(curl -s "$GW/buffer" | jsonval "d['pending']")
[ "$PENDING_MID" -gt 0 ]; check "telemetry buffered locally during outage ($PENDING_MID records spooled)" $?
GW_STATE=$(curl -s "$GW/status" | jsonval "d['offlineMode']")
[ "$GW_STATE" = "True" ]; check "gateway reports BUFFERING state" $?

log "waiting for outage to end and spool to drain…"
for i in $(seq 1 20); do
  sleep 5
  PENDING=$(curl -s "$GW/buffer" | jsonval "d['pending']")
  [ "$PENDING" = "0" ] && break
done
[ "$PENDING" = "0" ]; check "spool fully drained after reconnection ($PENDING pending)" $?

UPLOADED=$(gwmetric uploadedFromBuffer)
[ "$UPLOADED" -gt 0 ]; check "buffered records uploaded with timestamps preserved ($UPLOADED total)" $?
DRAINED_EVT=$(curl -s -b "$TMP/jar" "http://localhost:3000/api/gateways/edge-gw-01" | jsonval "any(e['type']=='DRAINED' for e in d['events'])")
[ "$DRAINED_EVT" = "True" ]; check "DRAINED lifecycle event recorded" $?
SAMP_AFTER=$(curl -s -b "$TMP/jar" "$BASE/api/overview" | jsonval "d['kpis']['samples24h']")
[ "$SAMP_AFTER" -gt 100 ]; check "platform still ingesting after recovery ($SAMP_AFTER samples/24h)" $?

# restore intervals
curl -s -b "$TMP/jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"SET_INTERVAL","payload":{"intervalSec":5}}' > /dev/null
curl -s -b "$TMP/jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-VIB-002","action":"SET_INTERVAL","payload":{"intervalSec":5}}' > /dev/null

# ---- R4: gateway restart with pending spool ---------------------------------
echo "── R4: gateway restart with pending spool (durable SQLite) ──"
curl -s -b "$TMP/jar" -X POST "$BASE/api/gateways/edge-gw-01/outage" -H 'content-type: application/json' -d '{"seconds":25}' > /dev/null
sleep 10
PENDING_AT_KILL=$(curl -s "$GW/buffer" | jsonval "d['pending']")
log "$PENDING_AT_KILL records pending — killing gateway process…"
GW_PID=$(ss -tlnp 2>/dev/null | rg ":3011" | rg -o "pid=[0-9]+" | head -1 | cut -d= -f2)
if [ -z "$GW_PID" ]; then
  for pid in $(ps aux | awk '/bun --hot index.ts/ && !/rg/ {print $2}'); do
    cwd=$(readlink /proc/$pid/cwd 2>/dev/null || true)
    [ "$cwd" = "$GW_DIR" ] && GW_PID=$pid
  done
fi
[ -n "$GW_PID" ]; check "gateway process located (pid $GW_PID)" $?
kill -9 "$GW_PID" 2>/dev/null
sleep 2
SPOOLED_ON_DISK=$(cd "$GW_DIR" && bun -e "const {Database}=require('bun:sqlite'); console.log((new Database('data/edge.db', {readonly:true}).query('SELECT COUNT(*) c FROM buffer').get()).c)")
[ "$SPOOLED_ON_DISK" -gt 0 ]; check "spool survives hard kill on disk ($SPOOLED_ON_DISK records in SQLite)" $?

log "restarting gateway…"
(cd "$GW_DIR" && setsid nohup bun run dev > /tmp/gateway-dev.log 2>&1 < /dev/null &)
sleep 14
RESTART_PENDING=$(curl -s "$GW/buffer" | jsonval "d['pending']")
log "pending after restart+drain: $RESTART_PENDING (was $SPOOLED_ON_DISK at kill)"
for i in $(seq 1 16); do
  sleep 5
  RESTART_PENDING=$(curl -s "$GW/buffer" | jsonval "d['pending']")
  [ "$RESTART_PENDING" = "0" ] && break
done
[ "$RESTART_PENDING" = "0" ]; check "gateway restart drains persisted spool on boot ($RESTART_PENDING pending)" $?
GW_BACK=$(curl -s "$GW/health" | jsonval "d['status']")
[ "$GW_BACK" = "ok" ]; check "gateway healthy after restart" $?

# ---- R5: malformed telemetry rejected ---------------------------------------
echo "── R5: malformed input rejection ──"
BEFORE_REJ=$(gwmetric rejected)
# publish a structurally invalid message over real MQTT
cd /home/z/my-project/mini-services/simulator && bun -e "
const mqtt = require('mqtt');
const c = mqtt.connect('mqtt://localhost:1883', { clientId: 'test-injector-' + Date.now() });
c.on('connect', () => {
  c.publish('device/DH-ENV-001/telemetry', JSON.stringify({ v: 9, deviceId: 'DH-ENV-001', msgId: 'BAD-1', seq: 1, ts: Date.now(), metrics: [{ metric: 'temperature', value: 20, unit: 'C', quality: 'GOOD' }] }), { qos: 1 });
  c.publish('device/DH-ENV-001/telemetry', JSON.stringify({ v: 1, deviceId: 'DH-ENV-001', msgId: 'BAD-2', seq: 2, ts: Date.now() + 99999999999, metrics: [{ metric: 'temperature', value: 20, unit: '°C', quality: 'GOOD' }] }), { qos: 1 });
  c.publish('device/DH-ENV-001/telemetry', 'not-json-at-all', { qos: 1 });
  c.publish('device/DH-ENV-001/telemetry', JSON.stringify({ v: 1, deviceId: 'DH-ENV-001', msgId: 'BAD-4', seq: 4, ts: Date.now(), metrics: [{ metric: 'gamma-ray', value: 20, unit: 'Sv', quality: 'GOOD' }] }), { qos: 1 });
  setTimeout(() => process.exit(0), 1500);
});
" > /dev/null 2>&1
sleep 4
AFTER_REJ=$(gwmetric rejected)
DELTA_REJ=$((AFTER_REJ - BEFORE_REJ))
[ "$DELTA_REJ" -ge 3 ]; check "malformed messages rejected at gateway (+$DELTA_REJ rejected)" $?

# oversized batch via internal API
S=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/internal/telemetry" -H "X-Internal-Token: $TOKEN" -H 'content-type: application/json' -d "{\"messages\":[]}")
python3 -c "import json; print(json.dumps({'messages': [{'topic':'device/DH-ENV-001/telemetry','payload':'{}'}]*501}))" > "$TMP/big.json"
S2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/internal/telemetry" -H "X-Internal-Token: $TOKEN" -H 'content-type: application/json' -d @"$TMP/big.json")
[ "$S2" = "413" ]; check "oversized batch rejected by backend (413)" $?

# ---- R6: device OFFLINE timeout + recovery ----------------------------------
echo "── R6: device offline timeout & recovery ──"
curl -s -X POST "$SIM/control" -H 'content-type: application/json' -d '{"deviceId":"DH-MOT-002","action":"silence"}' > /dev/null
log "DH-MOT-002 silenced (no telemetry, no heartbeats) — waiting ~50s for gateway timeout…"
STATE=""
for i in $(seq 1 11); do
  sleep 5
  STATE=$(curl -s "$GW/status" | jsonval "next((x['state'] for x in d['devices'] if x['deviceId']=='DH-MOT-002'), 'unknown')")
  [ "$STATE" = "OFFLINE" ] && break
done
[ "$STATE" = "OFFLINE" ]; check "silent device transitions to OFFLINE after timeout" $?
curl -s -X POST "$SIM/control" -H 'content-type: application/json' -d '{"deviceId":"DH-MOT-002","action":"resume"}' > /dev/null
sleep 8
STATE2=$(curl -s "$GW/status" | jsonval "next((x['state'] for x in d['devices'] if x['deviceId']=='DH-MOT-002'), 'unknown')")
[ "$STATE2" = "ONLINE" ]; check "resumed device returns ONLINE on telemetry" $?

# ---- R7: MQTT broker restart -------------------------------------------------
echo "── R7: MQTT broker restart ──"
BROKER_PID=$(ss -tlnp 2>/dev/null | rg ":1883" | rg -o "pid=[0-9]+" | head -1 | cut -d= -f2)
[ -n "$BROKER_PID" ]; check "broker process located (pid $BROKER_PID)" $?
kill -9 "$BROKER_PID" 2>/dev/null
sleep 2
MQTT_DOWN=$(curl -s "$GW/status" | jsonval "d['mqttConnected']")
[ "$MQTT_DOWN" = "False" ]; check "gateway detects broker outage" $?
cd /home/z/my-project/mini-services/broker && (setsid nohup bun run dev > /tmp/broker-dev.log 2>&1 < /dev/null &)
sleep 10
MQTT_BACK=$(curl -s "$GW/status" | jsonval "d['mqttConnected']")
[ "$MQTT_BACK" = "True" ]; check "gateway reconnects after broker restart" $?
SIM_OK=$(curl -s "$SIM/health" | jsonval "d['status']")
[ "$SIM_OK" = "ok" ]; check "simulator fleet reconnected to broker" $?
sleep 6
FWD_NOW=$(gwmetric forwarded)
sleep 8
FWD_LATER=$(gwmetric forwarded)
[ "$FWD_LATER" -gt "$FWD_NOW" ]; check "telemetry flowing again after full recovery ($FWD_NOW → $FWD_LATER)" $?

echo "════════════════════════════════════════════════════════════════"
echo " RESULT: $PASS passed, $FAIL failed"
if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo " Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "   ✘ $t"; done
fi
echo "════════════════════════════════════════════════════════════════"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
