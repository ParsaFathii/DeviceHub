/**
 * DeviceHub — application shell (sidebar + topbar + view router).
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDhStore, ViewId } from "@/lib/store";
import { useRealtime } from "@/hooks/use-realtime";
import { DH, SimulatorBadge } from "./shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  LayoutDashboard, Radio, Bell, LineChart, Workflow, AlertTriangle, Sparkles, Terminal,
  Cpu, Settings, LogOut, Search, Activity, Wifi, WifiOff, ChevronRight,
} from "lucide-react";
import { OverviewView } from "./overview";
import { DevicesView } from "./devices";
import { DeviceDetailView } from "./device-detail";
import { GatewaysView } from "./gateways";
import { TelemetryExplorerView } from "./telemetry-explorer";
import { AutomationView } from "./automation";
import { AlertsView } from "./alerts";
import { AnomalyView } from "./anomaly";
import { CommandsAuditView } from "./commands-audit";
import { AiDiagnosticsView } from "./ai-diagnostics";
import { SettingsView } from "./settings";

const NAV: { id: ViewId; label: string; icon: React.ReactNode }[] = [
  { id: "overview", label: "Fleet Overview", icon: <LayoutDashboard className="h-[18px] w-[18px]" /> },
  { id: "devices", label: "Devices", icon: <Radio className="h-[18px] w-[18px]" /> },
  { id: "gateways", label: "Gateways", icon: <Cpu className="h-[18px] w-[18px]" /> },
  { id: "telemetry", label: "Telemetry Explorer", icon: <LineChart className="h-[18px] w-[18px]" /> },
  { id: "automation", label: "Automation Rules", icon: <Workflow className="h-[18px] w-[18px]" /> },
  { id: "alerts", label: "Alerts", icon: <AlertTriangle className="h-[18px] w-[18px]" /> },
  { id: "anomaly", label: "Anomaly Analysis", icon: <Sparkles className="h-[18px] w-[18px]" /> },
  { id: "commands", label: "Commands & Audit", icon: <Terminal className="h-[18px] w-[18px]" /> },
  { id: "ai", label: "AI Diagnostics", icon: <Activity className="h-[18px] w-[18px]" /> },
  { id: "settings", label: "Settings", icon: <Settings className="h-[18px] w-[18px]" /> },
];

const VIEW_TITLES: Record<ViewId, { title: string; subtitle: string }> = {
  overview: { title: "Fleet Overview", subtitle: "Real-time fleet health, telemetry and alerts" },
  devices: { title: "Devices", subtitle: "Registered device fleet — identity, state and health" },
  "device-detail": { title: "Device Details", subtitle: "Identity, telemetry history, alerts and commands" },
  gateways: { title: "Edge Gateways", subtitle: "Gateway health, offline buffer and delivery state" },
  telemetry: { title: "Telemetry Explorer", subtitle: "Historical measurements with aggregation and gap analysis" },
  automation: { title: "Automation Rules", subtitle: "Deterministic edge rules with execution history" },
  alerts: { title: "System Alerts", subtitle: "Real-time monitoring and incident management" },
  anomaly: { title: "Anomaly Analysis", subtitle: "Isolation Forest detection vs deterministic baseline" },
  commands: { title: "Commands & Audit", subtitle: "Command lifecycle with full operator audit trail" },
  ai: { title: "AI Diagnostics", subtitle: "Evidence-grounded assistant (advisory only)" },
  settings: { title: "Settings", subtitle: "Users, simulator control and platform services" },
};

export function Shell() {
  const view = useDhStore((s) => s.view);
  const setView = useDhStore((s) => s.setView);
  const user = useDhStore((s) => s.user);
  const setUser = useDhStore((s) => s.setUser);
  const socketConnected = useDhStore((s) => s.socketConnected);
  const ingestCounter = useDhStore((s) => s.ingestCounter);
  const activityFeed = useDhStore((s) => s.activityFeed);
  const selectedDeviceId = useDhStore((s) => s.selectedDeviceId);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [search, setSearch] = useState("");

  useRealtime(true);
  const queryClient = useQueryClient();

  // live alert count for the bell badge
  const { data: alertsData } = useQuery({
    queryKey: ["alerts", "bell"],
    queryFn: async () => {
      const res = await fetch("/api/alerts?state=ACTIVE&limit=5");
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 15000,
  });

  // invalidate queries when realtime events arrive
  useEffect(() => {
    const unsub = useDhStore.subscribe((state, prev) => {
      if (state.lastAlert !== prev.lastAlert || state.lastCommand !== prev.lastCommand || state.anomalyEvent !== prev.anomalyEvent) {
        queryClient.invalidateQueries({ queryKey: ["alerts"] });
        queryClient.invalidateQueries({ queryKey: ["commands"] });
        queryClient.invalidateQueries({ queryKey: ["anomalies"] });
        queryClient.invalidateQueries({ queryKey: ["overview"] });
      }
      if (state.gatewayState !== prev.gatewayState) {
        queryClient.invalidateQueries({ queryKey: ["gateways"] });
      }
    });
    return unsub;
  }, [queryClient]);

  const activeAlerts = alertsData?.kpis?.critical ?? 0;
  const title = VIEW_TITLES[view];

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  const initial = useMemo(() => (user?.name || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase(), [user]);

  return (
    <div className="flex min-h-screen items-stretch justify-center p-0 sm:p-4 lg:p-6" style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #0f172a 55%, #4c1d95 100%)" }}>
      <div
        className="flex min-h-screen w-full max-w-[1560px] flex-col overflow-hidden rounded-none shadow-2xl sm:min-h-[calc(100vh-2rem)] sm:rounded-3xl"
        style={{ backgroundColor: DH.bg, border: `1px solid ${DH.border}` }}
      >
        <div className="flex flex-1 overflow-hidden">
          {/* ---------------- Sidebar ---------------- */}
          <aside
            className={`hidden flex-col border-r transition-all duration-200 md:flex ${navCollapsed ? "w-[76px]" : "w-[248px]"}`}
            style={{ borderColor: DH.border, backgroundColor: "#0D1424" }}
          >
            <div className="flex items-center gap-3 px-4 py-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: DH.accent }}>
                <Activity className="h-5 w-5 text-white" />
              </div>
              {!navCollapsed && (
                <div className="overflow-hidden">
                  <div className="text-[16px] font-bold leading-tight" style={{ color: DH.textPrimary }}>DeviceHub</div>
                  <div className="text-[10px] font-medium" style={{ color: DH.textSecondary }}>IoT OPERATIONS</div>
                </div>
              )}
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
              {NAV.map((item) => {
                const active = view === item.id || (view === "device-detail" && item.id === "devices");
                return (
                  <button
                    key={item.id}
                    onClick={() => setView(item.id)}
                    title={item.label}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
                      active ? "" : "hover:bg-slate-700/30"
                    }`}
                    style={active ? { backgroundColor: DH.surfaceHover, color: DH.textPrimary, boxShadow: `inset 3px 0 0 ${DH.accent}` } : { color: DH.textSecondary }}
                  >
                    <span className="shrink-0">{item.icon}</span>
                    {!navCollapsed && <span className="truncate">{item.label}</span>}
                    {!navCollapsed && item.id === "alerts" && activeAlerts > 0 && (
                      <span
                        className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold"
                        style={{ backgroundColor: DH.danger, color: "white" }}
                      >
                        {activeAlerts}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="space-y-1 border-t px-3 py-4" style={{ borderColor: DH.border }}>
              {!navCollapsed && (
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium" style={{ color: socketConnected ? DH.success : DH.warning }}>
                    {socketConnected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
                    {socketConnected ? "REALTIME LIVE" : "RECONNECTING…"}
                  </span>
                  <SimulatorBadge />
                </div>
              )}
              <button
                onClick={() => setNavCollapsed(!navCollapsed)}
                className="hidden w-full items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-medium hover:bg-slate-700/30 md:flex"
                style={{ color: DH.textSecondary }}
              >
                <ChevronRight className={`h-4 w-4 transition-transform ${navCollapsed ? "" : "rotate-180"}`} />
                {!navCollapsed && "Collapse"}
              </button>
              <button
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-medium hover:bg-slate-700/30"
                style={{ color: DH.textSecondary }}
              >
                <LogOut className="h-[18px] w-[18px] shrink-0" />
                {!navCollapsed && "Log Out"}
              </button>
            </div>
          </aside>

          {/* ---------------- Main ---------------- */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Topbar */}
            <header className="flex items-center gap-3 border-b px-4 py-3.5 sm:px-6" style={{ borderColor: DH.border }}>
              <div className="flex items-center gap-2 md:hidden">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ backgroundColor: DH.accent }}>
                  <Activity className="h-4 w-4 text-white" />
                </div>
              </div>
              <div className="relative hidden flex-1 max-w-[420px] sm:block">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: DH.textSecondary }} />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && search.trim()) {
                      setView("devices");
                    }
                  }}
                  placeholder="Search devices, alerts, commands…"
                  className="h-9 rounded-full border-slate-700 bg-slate-800/50 pl-9 text-[13px] text-slate-100 placeholder:text-slate-500"
                />
              </div>
              <div className="ml-auto flex items-center gap-2 sm:gap-3">
                <span className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold lg:flex" style={{ color: DH.cyan, backgroundColor: `${DH.cyan}12` }}>
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full" style={{ backgroundColor: DH.cyan }} />
                  {ingestCounter > 0 ? `${ingestCounter} live samples` : "awaiting data"}
                </span>
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-slate-700/40" style={{ color: DH.textSecondary }}>
                      <Bell className="h-[18px] w-[18px]" />
                      {activeAlerts > 0 && (
                        <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold text-white" style={{ backgroundColor: DH.danger }}>
                          {activeAlerts}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[340px] border-slate-700 bg-[#151E2D] p-0" sideOffset={8}>
                    <div className="border-b px-4 py-3 text-[13px] font-semibold text-slate-100" style={{ borderColor: DH.border }}>
                      Recent Activity {socketConnected ? "(live)" : "(offline)"}
                    </div>
                    <div className="max-h-[320px] overflow-y-auto p-2">
                      {activityFeed.length === 0 && (
                        <div className="px-3 py-8 text-center text-[12px]" style={{ color: DH.textSecondary }}>
                          No live activity yet — waiting for platform events…
                        </div>
                      )}
                      {activityFeed.slice(0, 12).map((a) => (
                        <div key={a.id} className="rounded-lg px-3 py-2 hover:bg-slate-700/30">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  a.type === "ALERT" ? DH.danger :
                                  a.type === "COMMAND" ? DH.accent :
                                  a.type === "GATEWAY" ? DH.warning :
                                  a.type === "ANOMALY" ? DH.purple : DH.success,
                              }}
                            />
                            <span className="text-[12px] leading-snug" style={{ color: DH.textPrimary }}>{a.message}</span>
                          </div>
                          <div className="pl-3.5 text-[10px]" style={{ color: DH.textSecondary }}>{new Date(a.ts).toLocaleTimeString()}</div>
                        </div>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <div className="hidden h-6 w-px sm:block" style={{ backgroundColor: DH.border }} />
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-9 w-9 border" style={{ borderColor: DH.border }}>
                    <AvatarFallback className="text-[11px] font-bold" style={{ backgroundColor: `${DH.accent}25`, color: "#93c5fd" }}>
                      {initial}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden leading-tight lg:block">
                    <div className="text-[13px] font-semibold" style={{ color: DH.textPrimary }}>{user?.name}</div>
                    <div className="text-[10px] font-medium" style={{ color: DH.accent }}>{user?.role}</div>
                  </div>
                </div>
              </div>
            </header>

            {/* Page title bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6" style={{ borderColor: DH.border }}>
              <div>
                <h1 className="text-[20px] font-bold" style={{ color: DH.textPrimary }}>{title.title}</h1>
                <p className="mt-0.5 text-[12px]" style={{ color: DH.textSecondary }}>{title.subtitle}</p>
              </div>
              {view === "device-detail" && selectedDeviceId && (
                <Button variant="outline" size="sm" onClick={() => setView("devices")} className="border-slate-700 bg-transparent text-slate-300 hover:bg-slate-700/40">
                  <ChevronRight className="mr-1 h-3.5 w-3.5 rotate-180" /> Back to devices
                </Button>
              )}
            </div>

            {/* View content */}
            <main className="flex-1 overflow-y-auto p-4 sm:p-6" style={{ maxHeight: "calc(100vh - 132px)" }}>
              <div className="mx-auto max-w-[1400px]">
                {view === "overview" && <OverviewView />}
                {view === "devices" && <DevicesView search={search} />}
                {view === "device-detail" && <DeviceDetailView deviceId={selectedDeviceId} />}
                {view === "gateways" && <GatewaysView />}
                {view === "telemetry" && <TelemetryExplorerView />}
                {view === "automation" && <AutomationView />}
                {view === "alerts" && <AlertsView />}
                {view === "anomaly" && <AnomalyView />}
                {view === "commands" && <CommandsAuditView />}
                {view === "ai" && <AiDiagnosticsView />}
                {view === "settings" && <SettingsView />}
              </div>
            </main>
          </div>
        </div>

        {/* Sticky footer */}
        <footer className="mt-auto flex items-center justify-between border-t px-4 py-2.5 sm:px-6" style={{ borderColor: DH.border, backgroundColor: "#0D1424" }}>
          <span className="text-[10px]" style={{ color: DH.textSecondary }}>
            DeviceHub · Copyright © 2026 Parsa Fathi · Apache-2.0
          </span>
          <span className="flex items-center gap-2 text-[10px]" style={{ color: DH.textSecondary }}>
            <SimulatorBadge />
            <span className="hidden sm:inline">Fleet runs on deterministic simulated devices</span>
            {socketConnected && <span className="hidden items-center gap-1 sm:flex" style={{ color: DH.success }}><Wifi className="h-3 w-3" /> live</span>}
          </span>
        </footer>
      </div>
    </div>
  );
}
