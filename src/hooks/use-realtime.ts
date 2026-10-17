/**
 * DeviceHub realtime hook — socket.io via the Caddy gateway.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useDhStore, LiveSample } from "@/lib/store";

export function useRealtime(enabled: boolean) {
  const socketRef = useRef<Socket | null>(null);
  const pushTelemetry = useDhStore((s) => s.pushTelemetry);
  const pushActivity = useDhStore((s) => s.pushActivity);
  const setSocketConnected = useDhStore((s) => s.setSocketConnected);
  const setLastAlert = useDhStore((s) => s.setLastAlert);
  const setLastCommand = useDhStore((s) => s.setLastCommand);
  const setGatewayState = useDhStore((s) => s.setGatewayState);
  const setAnomalyEvent = useDhStore((s) => s.setAnomalyEvent);

  useEffect(() => {
    if (!enabled) return;
    // Gateway rule: always io("/?XTransformPort=3013") — never a direct host:port.
    const socket = io("/?XTransformPort=3013", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setSocketConnected(true));
    socket.on("disconnect", () => setSocketConnected(false));
    socket.on("connect_error", () => setSocketConnected(false));

    socket.on("telemetry", (data: any) => {
      if (data?.backfill) {
        pushActivity({ type: "TELEMETRY", message: data.message || `Backfill: ${data.samples?.length || 0} offline-buffered samples stored`, ts: new Date().toISOString() });
        return;
      }
      // live shape: { devices: { deviceId: [{metric, value, unit, quality, sampleTs, simulated}] } }
      const samples: LiveSample[] = [];
      if (data?.devices && typeof data.devices === "object") {
        for (const [deviceId, arr] of Object.entries<any[]>(data.devices)) {
          for (const s of arr || []) {
            samples.push({ deviceId, metric: s.metric, value: s.value, unit: s.unit, quality: s.quality, sampleTs: s.sampleTs, simulated: s.simulated });
          }
        }
      }
      if (samples.length) pushTelemetry(samples);
    });

    socket.on("activity", (data: any) => {
      if (data?.type && data?.message) pushActivity({ type: data.type, message: data.message, ts: data.ts || new Date().toISOString() });
    });

    socket.on("alert", (data: any) => {
      setLastAlert(data);
      if (data?.severity && data?.title) {
        pushActivity({ type: "ALERT", message: `${data.severity}: ${data.title}${data.deviceName ? ` (${data.deviceName})` : ""}`, ts: data.createdAt || new Date().toISOString() });
      }
    });

    socket.on("alert-updated", (data: any) => {
      if (data?.alertId && data?.state) {
        pushActivity({ type: "ALERT", message: `Alert ${data.alertId} → ${data.state}${data.resolvedBy ? ` by ${data.resolvedBy}` : data.acknowledgedBy ? ` by ${data.acknowledgedBy}` : ""}`, ts: new Date().toISOString() });
      }
    });

    socket.on("command", (data: any) => {
      setLastCommand(data);
      if (data?.commandId && data?.state) {
        pushActivity({ type: "COMMAND", message: `Command ${data.commandId} (${data.action || "?"} on ${data.deviceId || "?"}) → ${data.state}${data.ackCode ? ` [${data.ackCode}]` : ""}`, ts: data.ts || new Date().toISOString() });
      }
    });

    socket.on("gateway", (data: any) => {
      setGatewayState(data);
      if (data?.state) {
        pushActivity({ type: "GATEWAY", message: `Edge gateway ${data.state}${data.buffering ? " — buffering locally" : data.drained ? " — spool drained" : ""}`, ts: new Date().toISOString() });
      }
    });

    socket.on("anomaly", (data: any) => {
      setAnomalyEvent(data);
      if (data?.count) {
        pushActivity({ type: "ANOMALY", message: `Anomaly detection: ${data.count} new findings stored`, ts: new Date().toISOString() });
      }
    });

    socket.on("device-state", (data: any) => {
      if (data?.deviceId && data?.state) {
        pushActivity({ type: "DEVICE", message: `Device ${data.deviceId} → ${data.state}`, ts: new Date().toISOString() });
      }
    });

    socket.on("rule-execution", () => { /* history lists refresh via query invalidation */ });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocketConnected(false);
    };
  }, [enabled, pushTelemetry, pushActivity, setSocketConnected, setLastAlert, setLastCommand, setGatewayState, setAnomalyEvent]);

  return socketRef;
}
