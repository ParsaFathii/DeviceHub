#!/usr/bin/env bash
# =============================================================================
# DeviceHub — Functional test suite (PASS 1)
# Tests the public API surface against the LIVE running platform.
# Copyright © 2026 Parsa Fathi — Apache-2.0
#
# Usage: bash tests/api.test.sh
# Requires: platform running (web :3000, gateway :3011, simulator :3012,
#           realtime :3013, analytics :3014, broker :1883)
# =============================================================================
set -u
BASE="http://localhost:3000"
GW="http://localhost:3011"
SIM="http://localhost:3012"
ANA="http://localhost:3014"
TMP="$(mktemp -d)"
PASS=0; FAIL=0; FAILED_TESTS=()

check() { # name, condition(0=ok)
  if [ "$2" -eq 0 ]; then PASS=$((PASS+1)); echo "  ✔ $1";
  else FAIL=$((FAIL+1)); FAILED_TESTS+=("$1"); echo "  ✘ $1"; fi
}

jsonval() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)" 2>/dev/null; }

echo "════════════════════════════════════════════════════════════════"
echo " DeviceHub Functional Test Suite (PASS 1 — Functional)"
echo "════════════════════════════════════════════════════════════════"

# --- 1. Authentication --------------------------------------------------------
echo "── Authentication ──"
S=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/overview")
[ "$S" = "401" ]; check "unauthenticated /api/overview rejected (401)" $?

S=$(curl -s -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"username":"admin","password":"WRONG"}' -o /dev/null -w "%{http_code}")
[ "$S" = "401" ]; check "wrong password rejected (401)" $?

curl -s -c "$TMP/admin.jar" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"username":"admin","password":"admin123"}' > "$TMP/login.json"
ROLE=$(jsonval "d['user']['role']" < "$TMP/login.json")
[ "$ROLE" = "ADMIN" ]; check "admin login returns ADMIN role" $?

curl -s -c "$TMP/op.jar" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"username":"operator","password":"operator123"}' > /dev/null
curl -s -c "$TMP/view.jar" -X POST "$BASE/api/auth/login" -H 'content-type: application/json' -d '{"username":"viewer","password":"viewer123"}' > /dev/null
curl -s -b "$TMP/view.jar" "$BASE/api/auth/me" > "$TMP/me.json"
R=$(jsonval "d['user']['role']" < "$TMP/me.json")
[ "$R" = "VIEWER" ]; check "viewer session restored via cookie" $?

# --- 2. Fleet & devices -------------------------------------------------------
echo "── Fleet & Devices ──"
curl -s -b "$TMP/admin.jar" "$BASE/api/overview" > "$TMP/overview.json"
TD=$(jsonval "d['kpis']['totalDevices']" < "$TMP/overview.json")
[ "$TD" -ge 15 ]; check "overview reports ≥15 devices ($TD)" $?
SAMP=$(jsonval "d['kpis']['samples24h']" < "$TMP/overview.json")
[ "$SAMP" -gt 100 ]; check "overview reports live sample volume ($SAMP/24h)" $?
SIMN=$(jsonval "d['dataOrigin']['simulatedDevices']" < "$TMP/overview.json")
[ "$SIMN" = "$TD" ]; check "data origin discloses simulator fleet ($SIMN/$TD)" $?
[ -n "$(jsonval "len(d['zones'])" < "$TMP/overview.json" 2>/dev/null)" ] && Z=$(jsonval "len(d['zones'])" < "$TMP/overview.json") || Z=0
[ "$Z" -ge 5 ]; check "overview includes zone health ($Z zones)" $?

curl -s -b "$TMP/admin.jar" "$BASE/api/devices" > "$TMP/devices.json"
DN=$(jsonval "len(d['devices'])" < "$TMP/devices.json")
[ "$DN" -ge 15 ]; check "device list returns fleet ($DN)" $?
HAS_T=$(jsonval "any(d['devices'][i]['temperature'] for i in range(len(d['devices'])))" < "$TMP/devices.json")
[ "$HAS_T" = "True" ]; check "device list carries live temperature column" $?

curl -s -b "$TMP/admin.jar" "$BASE/api/devices/DH-ENV-001" > "$TMP/detail.json"
FW=$(jsonval "d['device']['firmwareVersion']" < "$TMP/detail.json")
[ -n "$FW" ]; check "device detail includes firmware identity ($FW)" $?
TM=$(jsonval "len(d.get('telemetry',{}))" < "$TMP/detail.json")
[ "$TM" -ge 2 ]; check "device detail includes telemetry series ($TM metrics)" $?
ORIGIN=$(jsonval "d['device']['origin']" < "$TMP/detail.json")
[ "$ORIGIN" = "SIMULATOR" ]; check "device detail labels data origin (SIMULATOR)" $?

S=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMP/admin.jar" "$BASE/api/devices/DH-NOPE-999")
[ "$S" = "404" ]; check "unknown device detail returns 404" $?

# --- 3. Telemetry explorer ----------------------------------------------------
echo "── Telemetry ──"
curl -s -b "$TMP/admin.jar" "$BASE/api/telemetry?deviceId=DH-ENV-001&metric=temperature&hours=1&intervalSec=60" > "$TMP/telemetry.json"
TS=$(jsonval "len(d['samples'])" < "$TMP/telemetry.json")
[ "$TS" -gt 10 ]; check "telemetry query returns samples ($TS)" $?
AGG=$(jsonval "d['aggregation']" < "$TMP/telemetry.json")
echo "$AGG" | rg -q "python-analytics|typescript"; check "aggregation engine reported ($AGG)" $?
BK=$(jsonval "len(d['buckets'])" < "$TMP/telemetry.json")
[ "$BK" -gt 0 ]; check "aggregated buckets computed ($BK)" $?

# --- 4. Commands lifecycle ----------------------------------------------------
echo "── Command lifecycle ──"
S=$(curl -s -o "$TMP/vcmd.json" -w "%{http_code}" -b "$TMP/view.jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"REBOOT"}')
[ "$S" = "403" ]; check "VIEWER cannot send commands (403)" $?

S=$(curl -s -o "$TMP/badcmd.json" -w "%{http_code}" -b "$TMP/op.jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"ACTUATE_DOOR"}')
[ "$S" = "422" ]; check "unsupported action rejected against capabilities (422)" $?

S=$(curl -s -o "$TMP/badcmd2.json" -w "%{http_code}" -b "$TMP/op.jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"SET_INTERVAL","payload":{"intervalSec":9999}}')
[ "$S" = "422" ]; check "out-of-range command payload rejected (422)" $?

curl -s -b "$TMP/op.jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-VIB-002","action":"SELF_TEST","payload":{}}' > "$TMP/cmd.json"
CID=$(jsonval "d['commandId']" < "$TMP/cmd.json")
ST=$(jsonval "d['state']" < "$TMP/cmd.json")
[ -n "$CID" ] && [ "$ST" != "FAILED" ]; check "SELF_TEST command accepted & dispatched ($CID → $ST)" $?

ACKCODE=""
for i in $(seq 1 12); do
  sleep 1
  curl -s -b "$TMP/op.jar" "$BASE/api/commands/$CID" > "$TMP/cmdstate.json"
  ST=$(jsonval "d['command']['state']" < "$TMP/cmdstate.json")
  ACKCODE=$(jsonval "d['command']['ackCode']" < "$TMP/cmdstate.json")
  [ "$ST" = "SUCCEEDED" ] || [ "$ST" = "FAILED" ] && break
done
[ "$ST" = "SUCCEEDED" ] && [ "$ACKCODE" = "OK" ]; check "command reaches SUCCEEDED via real device ack ($ST/$ACKCODE)" $?

curl -s -b "$TMP/op.jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"SET_INTERVAL","payload":{"intervalSec":7}}' > "$TMP/cmd2.json"
CID2=$(jsonval "d['commandId']" < "$TMP/cmd2.json")
sleep 4
curl -s -b "$TMP/op.jar" "$BASE/api/commands/$CID2" > "$TMP/cmd2state.json"
ST2=$(jsonval "d['command']['state']" < "$TMP/cmd2state.json")
[ "$ST2" = "SUCCEEDED" ]; check "SET_INTERVAL executed by simulator ($ST2)" $?
# restore interval
curl -s -b "$TMP/op.jar" -X POST "$BASE/api/commands" -H 'content-type: application/json' -d '{"deviceId":"DH-ENV-001","action":"SET_INTERVAL","payload":{"intervalSec":5}}' > /dev/null

# --- 5. Alerts ----------------------------------------------------------------
echo "── Alerts ──"
curl -s -b "$TMP/admin.jar" "$BASE/api/alerts?state=ACTIVE&limit=5" > "$TMP/alerts.json"
CRIT=$(jsonval "d['kpis']['critical']" < "$TMP/alerts.json")
[ "$CRIT" -ge 1 ]; check "automation produced critical alerts ($CRIT active)" $?
EV=$(jsonval "d['alerts'][0]['evidence'].get('threshold') if d['alerts'] else None" < "$TMP/alerts.json")
[ -n "$EV" ]; check "alerts carry deterministic rule evidence (threshold=$EV)" $?

AID=$(jsonval "d['alerts'][0]['alertId']" < "$TMP/alerts.json")
curl -s -b "$TMP/op.jar" -X POST "$BASE/api/alerts/$AID/ack" > "$TMP/ack.json"
AK=$(jsonval "d.get('state','')" < "$TMP/ack.json")
[ "$AK" = "ACKNOWLEDGED" ]; check "alert acknowledged by operator ($AID)" $?
S=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMP/op.jar" -X POST "$BASE/api/alerts/$AID/ack")
[ "$S" = "409" ]; check "double-ack rejected (409)" $?
curl -s -b "$TMP/op.jar" -X POST "$BASE/api/alerts/$AID/resolve" > /dev/null
S=$(curl -s -o /dev/null -w "%{http_code}" -b "$TMP/view.jar" -X POST "$BASE/api/alerts/$AID/resolve")
[ "$S" = "403" ]; check "VIEWER cannot resolve alerts (403)" $?

# --- 6. Automation rules ------------------------------------------------------
echo "── Automation rules ──"
curl -s -b "$TMP/admin.jar" "$BASE/api/rules" > "$TMP/rules.json"
RN=$(jsonval "len(d['rules'])" < "$TMP/rules.json")
[ "$RN" -ge 6 ]; check "seeded rules listed ($RN)" $?
FIRED=$(jsonval "d['stats']['totalFired']" < "$TMP/rules.json")
[ "$FIRED" -ge 1 ]; check "rule execution history shows FIRED events ($FIRED)" $?

curl -s -b "$TMP/op.jar" -X POST "$BASE/api/rules" -H 'content-type: application/json' -d '{"name":"Test Rule High Pressure","metric":"pressure","condition":"ABOVE","threshold":1050,"durationSec":60,"cooldownSec":300,"severity":"WARNING","deviceSelector":{"type":"ENV_SENSOR"}}' > "$TMP/newrule.json"
NRID=$(jsonval "d['rule']['ruleId']" < "$TMP/newrule.json")
[ -n "$NRID" ]; check "operator can create rule ($NRID)" $?
curl -s -b "$TMP/op.jar" -X PATCH "$BASE/api/rules/$NRID" -H 'content-type: application/json' -d '{"threshold":1060}' > "$TMP/rulever.json"
RV=$(jsonval "d['version']" < "$TMP/rulever.json")
[ "$RV" = "2" ]; check "semantic edit increments rule version (v$RV)" $?
curl -s -b "$TMP/op.jar" -X PATCH "$BASE/api/rules/$NRID" -H 'content-type: application/json' -d '{"enabled":false}' > /dev/null
echo "  (test rule $NRID disabled — cleanup)"

# --- 7. Audit -----------------------------------------------------------------
echo "── Audit trail ──"
curl -s -b "$TMP/admin.jar" "$BASE/api/audit?limit=100" > "$TMP/audit.json"
HAS_CMD=$(jsonval "any(e['action']=='COMMAND_REQUESTED' for e in d['events'])" < "$TMP/audit.json")
[ "$HAS_CMD" = "True" ]; check "audit records COMMAND_REQUESTED" $?
HAS_ACK=$(jsonval "any(e['action']=='ALERT_ACKNOWLEDGED' for e in d['events'])" < "$TMP/audit.json")
[ "$HAS_ACK" = "True" ]; check "audit records ALERT_ACKNOWLEDGED" $?
HAS_LOGIN=$(jsonval "any(e['action']=='LOGIN' for e in d['events'])" < "$TMP/audit.json")
[ "$HAS_LOGIN" = "True" ]; check "audit records LOGIN events" $?

# --- 8. Services & analytics --------------------------------------------------
echo "── Services & Analytics ──"
curl -s -b "$TMP/admin.jar" "$BASE/api/system/status" > "$TMP/sys.json"
DBUP=$(jsonval "d['database']['status']" < "$TMP/sys.json")
GWUP=$(jsonval "d['gateway']['status']" < "$TMP/sys.json")
ANAUP=$(jsonval "d['analytics']['status']" < "$TMP/sys.json")
SIMUP=$(jsonval "d['simulator']['status']" < "$TMP/sys.json")
MQTTUP=$(jsonval "d['mqttBroker']['status']" < "$TMP/sys.json")
[ "$DBUP" = "up" ] && [ "$GWUP" = "up" ] && [ "$ANAUP" = "up" ] && [ "$SIMUP" = "up" ] && [ "$MQTTUP" = "up" ]; check "all platform services healthy (db/gw/ana/sim/mqtt)" $?

curl -s -b "$TMP/op.jar" -X POST "$BASE/api/analytics/detect" -H 'content-type: application/json' -d '{"windowMin":60,"contamination":0.03}' > "$TMP/detect.json"
IF_CNT=$(jsonval "len(d.get('findings',[]))" < "$TMP/detect.json")
BSF=$(jsonval "len(d.get('baselineFindings',[]))" < "$TMP/detect.json")
[ $((IF_CNT+BSF)) -gt 0 ]; check "anomaly detection produced findings (IF:$IF_CNT, baseline:$BSF)" $?

curl -s -b "$TMP/op.jar" -X POST "$BASE/api/analytics/evaluate" > "$TMP/eval.json"
F1=$(jsonval "d['overall']['isolation_forest']['f1']" < "$TMP/eval.json")
BF1=$(jsonval "d['overall']['zscore_baseline']['f1']" < "$TMP/eval.json")
python3 -c "exit(0 if 0 <= $F1 <= 1 and 0 <= $BF1 <= 1 else 1)" 2>/dev/null; check "ML evaluation returns valid metrics (IF F1=$F1, baseline F1=$BF1)" $?
DATASET=$(jsonval "sum(p['sampleCount'] for p in d['patterns'])" < "$TMP/eval.json")
[ "$DATASET" -gt 500 ]; check "evaluation dataset is substantial ($DATASET labeled samples)" $?

curl -s -b "$TMP/admin.jar" "$BASE/api/anomalies?limit=50" > "$TMP/anoms.json"
AF=$(jsonval "len(d['findings'])" < "$TMP/anoms.json")
[ "$AF" -gt 0 ]; check "anomaly findings persisted & listed ($AF)" $?

# --- 9. AI diagnostics --------------------------------------------------------
echo "── AI diagnostics (evidence-grounded) ──"
curl -s -b "$TMP/admin.jar" -X POST "$BASE/api/ai/diagnostics" -H 'content-type: application/json' -d '{"question":"Which device currently has the highest temperature? Answer from evidence only."}' > "$TMP/ai.json"
EV_D=$(jsonval "d['evidenceSummary']['devices']" < "$TMP/ai.json")
ANSWER=$(jsonval "d['answer'][:200]" < "$TMP/ai.json")
[ -n "$EV_D" ] && [ "$EV_D" -gt 0 ]; check "AI answer grounded in recorded evidence ($EV_D devices)" $?
echo "$ANSWER" | rg -qi "DH-ENV-003"; check "AI identifies DH-ENV-003 as hottest device from evidence" $?
curl -s -b "$TMP/view.jar" "$BASE/api/ai/status" > "$TMP/aist.json"
AIST=$(jsonval "d['status']" < "$TMP/aist.json")
[ "$AIST" = "available" ]; check "AI provider real status reported ($AIST)" $?

# --- 10. Gateway metrics ------------------------------------------------------
echo "── Edge gateway ──"
curl -s "$GW/status" > "$TMP/gw.json"
FWD_A=$(jsonval "d['metrics']['forwarded']" < "$TMP/gw.json")
DEDUP=$(jsonval "d['metrics']['deduped']" < "$TMP/gw.json")
MQTTC=$(jsonval "d['mqttConnected']" < "$TMP/gw.json")
sleep 8
curl -s "$GW/status" > "$TMP/gw2.json"
FWD_B=$(jsonval "d['metrics']['forwarded']" < "$TMP/gw2.json")
[ $((FWD_B - FWD_A)) -ge 5 ]; check "gateway is actively forwarding telemetry (+$((FWD_B-FWD_A)) in 8s, total $FWD_B)" $?
[ "$MQTTC" = "True" ]; check "gateway MQTT session connected" $?

curl -s "$SIM/status" > "$TMP/sim.json"
SIMN2=$(jsonval "len(d['fleet'])" < "$TMP/sim.json")
[ "$SIMN2" -ge 15 ]; check "simulator fleet running ($SIMN2 devices)" $?

echo "════════════════════════════════════════════════════════════════"
echo " RESULT: $PASS passed, $FAIL failed"
if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
  echo " Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do echo "   ✘ $t"; done
fi
echo "════════════════════════════════════════════════════════════════"
rm -rf "$TMP"
[ "$FAIL" -eq 0 ]
