/**
 * DeviceHub MQTT Broker (aedes)
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 *
 * Internal MQTT broker for the device ↔ gateway transport layer.
 * Port 1883 (TCP MQTT). Local development configuration (no TLS, anonymous
 * clients allowed) — production deployments must enable TLS + client certs
 * (see docs/MQTT.md).
 */
import aedes from "aedes";
import net from "net";

const PORT = 1883;

const broker = aedes({
  id: "devicehub-broker",
  concurrency: 100,
  heartbeatInterval: 60000,
  connectTimeout: 30000,
});

const stats = {
  startedAt: new Date().toISOString(),
  connections: 0,
  published: 0,
  delivered: 0,
  errors: 0,
};

broker.on("client", (client) => {
  stats.connections++;
  console.log(`[broker] client connected: ${client.id}`);
});

broker.on("clientDisconnect", (client) => {
  console.log(`[broker] client disconnected: ${client.id}`);
});

broker.on("clientError", (client, err) => {
  stats.errors++;
  console.warn(`[broker] client error: ${client.id} — ${err.message}`);
});

broker.on("publish", (packet, client) => {
  if (client) {
    stats.published++;
    if (stats.published % 50 === 1) {
      console.log(`[broker] publish #${stats.published}: ${packet.topic} from ${client.id} (qos=${packet.qos}, ${packet.payload?.length ?? 0}B)`);
    }
  }
});

broker.on("delivered", () => {
  stats.delivered++;
});

broker.on("subscribe", (subscriptions, client) => {
  console.log(`[broker] ${client.id} subscribes: ${subscriptions.map((s) => s.topic).join(", ")}`);
});

const server = net.createServer(broker.handle);
server.listen(PORT, () => {
  console.log(`[broker] DeviceHub MQTT broker listening on tcp://0.0.0.0:${PORT}`);
  console.log(`[broker] topic hierarchy:`);
  console.log(`  device/{deviceId}/telemetry  — sensor samples (QoS 1)`);
  console.log(`  device/{deviceId}/status     — heartbeats & state (QoS 1, retained)`);
  console.log(`  device/{deviceId}/command    — gateway → device commands (QoS 1)`);
  console.log(`  device/{deviceId}/ack        — device acknowledgements (QoS 1)`);
  console.log(`  gateway/{gatewayId}/status   — edge gateway status (retained)`);
});

// Health endpoint over a tiny TCP greeting is unnecessary internally; expose stats via stdout.
setInterval(() => {
  const connected = Array.from((broker as any).clients?.values?.() ?? []).length;
  console.log(`[broker] stats: connected=${connected} published=${stats.published} delivered=${stats.delivered} errors=${stats.errors}`);
}, 30000);

process.on("SIGINT", () => {
  console.log("[broker] shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});
