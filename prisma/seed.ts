/**
 * DeviceHub seed — creates users, groups, gateway, simulated device fleet and automation rules.
 * Copyright © 2026 Parsa Fathi
 */
import { db } from "@/lib/db";
import { randomBytes, pbkdf2Sync } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(password, salt, 60000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "pbkdf2") return false;
  const [, salt, hash] = parts;
  const candidate = pbkdf2Sync(password, salt, 60000, 32, "sha256").toString("hex");
  return candidate === hash;
}

async function main() {
  console.log("Seeding DeviceHub database...");

  // --- Users -----------------------------------------------------------------
  const users = [
    { username: "admin", name: "Parsa Fathi", role: "ADMIN" as const, email: "admin@devicehub.local" },
    { username: "operator", name: "Sara Operator", role: "OPERATOR" as const, email: "operator@devicehub.local" },
    { username: "viewer", name: "Viewer Guest", role: "VIEWER" as const, email: "viewer@devicehub.local" },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { username: u.username },
      update: {},
      create: { ...u, passwordHash: hashPassword(`${u.username}123`) },
    });
  }
  console.log("users: admin/operator/viewer (password = <username>123)");

  // --- Groups ----------------------------------------------------------------
  const groups = [
    { key: "assembly-1", name: "Assembly Line 1", description: "Primary assembly line sensors" },
    { key: "assembly-2", name: "Assembly Line 2", description: "Secondary assembly line sensors" },
    { key: "fabrication", name: "Fabrication", description: "Welding and fabrication area" },
    { key: "packaging", name: "Packaging", description: "Packaging unit sensors" },
    { key: "utilities", name: "Utilities", description: "Facility power and environment" },
    { key: "warehouse", name: "Warehouse", description: "Warehouse monitoring" },
  ];
  for (const g of groups) {
    await db.deviceGroup.upsert({ where: { key: g.key }, update: {}, create: g });
  }
  const groupMap = Object.fromEntries((await db.deviceGroup.findMany()).map((g) => [g.key, g.id]));

  // --- Gateway ---------------------------------------------------------------
  await db.gateway.upsert({
    where: { gatewayId: "edge-gw-01" },
    update: {},
    create: {
      gatewayId: "edge-gw-01",
      name: "Edge Gateway 01 (Plant North)",
      version: "1.0.0",
      state: "PROVISIONED",
      capabilities: JSON.stringify({
        transports: ["mqtt"],
        bufferLimit: 5000,
        dedup: true,
        automation: true,
      }),
      metrics: JSON.stringify({ forwarded: 0, buffered: 0, deduped: 0, dropped: 0, queueDepth: 0, uptimeSec: 0 }),
    },
  });

  // --- Device fleet (deterministic simulators) --------------------------------
  const fleet = [
    { deviceId: "DH-ENV-001", name: "Environmental Sensor 001", type: "ENV_SENSOR", groupId: "assembly-1", profile: "STABLE", seed: 11, zone: "Assembly Line 1" },
    { deviceId: "DH-ENV-002", name: "Environmental Sensor 002", type: "ENV_SENSOR", groupId: "assembly-2", profile: "GRADUAL_DRIFT", seed: 22, zone: "Assembly Line 2" },
    { deviceId: "DH-ENV-003", name: "Environmental Sensor 003", type: "ENV_SENSOR", groupId: "fabrication", profile: "THRESHOLD_VIOLATION", seed: 33, zone: "Fabrication" },
    { deviceId: "DH-TH-001", name: "Temp/Humidity Sensor 001", type: "TEMP_HUM", groupId: "packaging", profile: "STABLE", seed: 44, zone: "Packaging" },
    { deviceId: "DH-TH-002", name: "Temp/Humidity Sensor 002", type: "TEMP_HUM", groupId: "utilities", profile: "INTERMITTENT", seed: 55, zone: "Utilities" },
    { deviceId: "DH-MOT-001", name: "Motion Sensor 001", type: "MOTION", groupId: "assembly-1", profile: "STABLE", seed: 66, zone: "Assembly Line 1" },
    { deviceId: "DH-MOT-002", name: "Motion Sensor 002", type: "MOTION", groupId: "warehouse", profile: "STABLE", seed: 77, zone: "Warehouse" },
    { deviceId: "DH-PWR-001", name: "Power Meter 001", type: "POWER_METER", groupId: "assembly-1", profile: "STABLE", seed: 88, zone: "Assembly Line 1" },
    { deviceId: "DH-PWR-002", name: "Power Meter 002", type: "POWER_METER", groupId: "assembly-2", profile: "GRADUAL_DRIFT", seed: 99, zone: "Assembly Line 2" },
    { deviceId: "DH-PWR-003", name: "Power Meter 003", type: "POWER_METER", groupId: "fabrication", profile: "STABLE", seed: 111, zone: "Fabrication" },
    { deviceId: "DH-VIB-001", name: "Vibration Sensor 001", type: "VIBRATION", groupId: "assembly-1", profile: "SENSOR_FAULT", seed: 122, zone: "Assembly Line 1" },
    { deviceId: "DH-VIB-002", name: "Vibration Sensor 002", type: "VIBRATION", groupId: "fabrication", profile: "STABLE", seed: 133, zone: "Fabrication" },
    { deviceId: "DH-VLT-001", name: "Voltage/Current Sensor 001", type: "VOLTAGE", groupId: "utilities", profile: "STABLE", seed: 144, zone: "Utilities" },
    { deviceId: "DH-VLT-002", name: "Voltage/Current Sensor 002", type: "VOLTAGE", groupId: "assembly-2", profile: "INTERMITTENT", seed: 155, zone: "Assembly Line 2" },
    { deviceId: "DH-STS-001", name: "Status Monitor 001", type: "STATUS", groupId: "packaging", profile: "STALE", seed: 166, zone: "Packaging" },
    { deviceId: "DH-STS-002", name: "Status Monitor 002", type: "STATUS", groupId: "warehouse", profile: "STABLE", seed: 177, zone: "Warehouse" },
  ];

  const gw = await db.gateway.findUniqueOrThrow({ where: { gatewayId: "edge-gw-01" } });

  for (const d of fleet) {
    const capabilities = capabilitiesFor(d.type);
    await db.device.upsert({
      where: { deviceId: d.deviceId },
      update: {},
      create: {
        ...d,
        groupId: groupMap[d.groupId],
        origin: "SIMULATOR",
        firmwareVersion: "1.4.2",
        protocolVersion: 1,
        hardwareId: `HW-${d.deviceId.slice(3)}`,
        state: "PROVISIONED",
        health: 100,
        simulator: true,
        gatewayId: gw.id,
        capabilities: JSON.stringify(capabilities),
        config: JSON.stringify({ telemetryIntervalSec: 5, reportHeartbeat: true }),
      },
    });
  }
  console.log(`fleet: ${fleet.length} simulated devices provisioned`);

  // --- Automation rules --------------------------------------------------------
  const rules = [
    {
      ruleId: "rule-temp-high",
      name: "High Temperature Alert",
      deviceSelector: JSON.stringify({ type: "ENV_SENSOR" }),
      metric: "temperature",
      condition: "ABOVE",
      threshold: 85,
      durationSec: 120,
      severity: "CRITICAL",
      cooldownSec: 300,
      priority: 1,
    },
    {
      ruleId: "rule-temp-high-th",
      name: "High Temperature (Temp/Humidity)",
      deviceSelector: JSON.stringify({ type: "TEMP_HUM" }),
      metric: "temperature",
      condition: "ABOVE",
      threshold: 80,
      durationSec: 120,
      severity: "CRITICAL",
      cooldownSec: 300,
      priority: 1,
    },
    {
      ruleId: "rule-vibration",
      name: "High Vibration Alert",
      deviceSelector: JSON.stringify({ type: "VIBRATION" }),
      metric: "vibration",
      condition: "ABOVE",
      threshold: 8,
      durationSec: 60,
      severity: "CRITICAL",
      cooldownSec: 240,
      priority: 2,
    },
    {
      ruleId: "rule-power",
      name: "Power Overload Alert",
      deviceSelector: JSON.stringify({ type: "POWER_METER" }),
      metric: "power",
      condition: "ABOVE",
      threshold: 15,
      durationSec: 180,
      severity: "WARNING",
      cooldownSec: 600,
      priority: 3,
    },
    {
      ruleId: "rule-humidity-low",
      name: "Low Humidity Alert",
      deviceSelector: JSON.stringify({ type: "TEMP_HUM" }),
      metric: "humidity",
      condition: "BELOW",
      threshold: 25,
      durationSec: 300,
      severity: "INFO",
      cooldownSec: 900,
      priority: 4,
    },
    {
      ruleId: "rule-voltage",
      name: "Voltage Sag Alert",
      deviceSelector: JSON.stringify({ type: "VOLTAGE" }),
      metric: "voltage",
      condition: "BELOW",
      threshold: 207,
      durationSec: 120,
      severity: "WARNING",
      cooldownSec: 600,
      priority: 3,
    },
  ];
  for (const r of rules) {
    await db.automationRule.upsert({ where: { ruleId: r.ruleId }, update: {}, create: r });
  }
  console.log(`automation rules: ${rules.length}`);

  console.log("Seed complete.");
}

function capabilitiesFor(type: string) {
  switch (type) {
    case "ENV_SENSOR":
      return { metrics: ["temperature", "humidity", "pressure"], units: { temperature: "°C", humidity: "%", pressure: "hPa" }, commands: ["SET_INTERVAL", "REBOOT"] };
    case "TEMP_HUM":
      return { metrics: ["temperature", "humidity"], units: { temperature: "°C", humidity: "%" }, commands: ["SET_INTERVAL", "REBOOT"] };
    case "MOTION":
      return { metrics: ["motion"], units: { motion: "events/min" }, commands: ["SET_INTERVAL", "REBOOT"] };
    case "POWER_METER":
      return { metrics: ["power", "energy"], units: { power: "kW", energy: "kWh" }, commands: ["SET_INTERVAL", "RESET_ENERGY"] };
    case "VIBRATION":
      return { metrics: ["vibration"], units: { vibration: "mm/s" }, commands: ["SET_INTERVAL", "REBOOT", "SELF_TEST"] };
    case "VOLTAGE":
      return { metrics: ["voltage", "current"], units: { voltage: "V", current: "A" }, commands: ["SET_INTERVAL", "REBOOT"] };
    default:
      return { metrics: ["status"], units: { status: "code" }, commands: ["REBOOT"] };
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
