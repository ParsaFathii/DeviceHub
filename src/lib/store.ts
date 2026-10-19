/**
 * DeviceHub web client store (zustand) — view routing, auth, realtime state.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { create } from "zustand";

export type ViewId =
  | "overview"
  | "devices"
  | "device-detail"
  | "gateways"
  | "telemetry"
  | "automation"
  | "alerts"
  | "anomaly"
  | "commands"
  | "ai"
  | "settings";

export interface User {
  id: string;
  username: string;
  name: string;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
}

export interface ActivityItem {
  type: string;
  message: string;
  ts: string;
  id: number;
}

export interface LiveSample {
  deviceId: string;
  metric: string;
  value: number;
  unit: string;
  quality?: string;
  sampleTs: string;
  simulated?: boolean;
}

export interface AiSeed {
  deviceId?: string;
  question?: string;
  autoSend?: boolean;
}

interface DeviceState {
  // navigation
  view: ViewId;
  selectedDeviceId: string | null;
  setView: (v: ViewId) => void;
  openDevice: (deviceId: string) => void;
  aiSeed: AiSeed | null;
  openAi: (seed: AiSeed) => void;
  clearAiSeed: () => void;

  // auth
  user: User | null;
  setUser: (u: User | null) => void;

  // realtime
  socketConnected: boolean;
  setSocketConnected: (b: boolean) => void;
  telemetryFeed: LiveSample[];
  activityFeed: ActivityItem[];
  lastAlert: any | null;
  lastCommand: any | null;
  gatewayState: any | null;
  anomalyEvent: any | null;
  ingestCounter: number;
  pushTelemetry: (samples: LiveSample[]) => void;
  pushActivity: (a: { type: string; message: string; ts: string }) => void;
  setLastAlert: (a: any) => void;
  setLastCommand: (c: any) => void;
  setGatewayState: (g: any) => void;
  setAnomalyEvent: (a: any) => void;
}

let activityId = 0;

export const useDhStore = create<DeviceState>((set) => ({
  view: "overview",
  selectedDeviceId: null,
  setView: (v) => set({ view: v }),
  openDevice: (deviceId) => set({ view: "device-detail", selectedDeviceId: deviceId }),
  aiSeed: null,
  openAi: (seed) => set({ aiSeed: seed, view: "ai" }),
  clearAiSeed: () => set({ aiSeed: null }),

  user: null,
  setUser: (u) => set({ user: u }),

  socketConnected: false,
  setSocketConnected: (b) => set({ socketConnected: b }),
  telemetryFeed: [],
  activityFeed: [],
  lastAlert: null,
  lastCommand: null,
  gatewayState: null,
  anomalyEvent: null,
  ingestCounter: 0,
  pushTelemetry: (samples) =>
    set((s) => ({
      telemetryFeed: [...s.telemetryFeed, ...samples].slice(-600),
      ingestCounter: s.ingestCounter + samples.length,
    })),
  pushActivity: (a) =>
    set((s) => ({
      activityFeed: [{ ...a, id: ++activityId }, ...s.activityFeed].slice(0, 80),
    })),
  setLastAlert: (a) => set({ lastAlert: a }),
  setLastCommand: (c) => set({ lastCommand: c }),
  setGatewayState: (g) => set({ gatewayState: g }),
  setAnomalyEvent: (a) => set({ anomalyEvent: a }),
}));
