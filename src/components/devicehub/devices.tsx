/**
 * DeviceHub — Devices fleet view.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StatCard, StatusPill, DH, timeAgo, fmtVal, SimulatorBadge, EmptyState, severityColor, ProgressBar, healthColor } from "./shared";
import { useDhStore } from "@/lib/store";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Radio, Wifi, WifiOff, AlertTriangle, Search, Plus, MoreVertical, Thermometer, Zap, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function DevicesView({ search: externalSearch }: { search?: string }) {
  const [search, setSearch] = useState(externalSearch || "");
  const [stateFilter, setStateFilter] = useState("ALL");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [provisionOpen, setProvisionOpen] = useState(false);
  const openDevice = useDhStore((s) => s.openDevice);
  const user = useDhStore((s) => s.user);
  const { toast } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["devices", stateFilter, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (stateFilter !== "ALL") params.set("state", stateFilter);
      if (typeFilter !== "ALL") params.set("type", typeFilter);
      const res = await fetch(`/api/devices?${params}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    refetchInterval: 8000,
  });

  const devices = (data?.devices || []).filter((d: any) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return d.deviceId.toLowerCase().includes(q) || d.name.toLowerCase().includes(q) || (d.zone || "").toLowerCase().includes(q);
  });

  const counts = {
    total: data?.devices?.length || 0,
    online: (data?.devices || []).filter((d: any) => d.state === "ONLINE").length,
    offline: (data?.devices || []).filter((d: any) => d.state === "OFFLINE").length,
    alerts: (data?.devices || []).filter((d: any) => d.state === "DEGRADED" || d.state === "ERROR").length,
  };

  const types = [...new Set((data?.devices || []).map((d: any) => d.type))];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={<Radio className="h-5 w-5" />} label="Total Devices" value={counts.total} trend="registered fleet" trendUp />
        <StatCard icon={<Wifi className="h-5 w-5" />} label="Online" value={counts.online} trend="streaming telemetry" trendUp iconColor={DH.success} />
        <StatCard icon={<WifiOff className="h-5 w-5" />} label="Offline" value={counts.offline} trend="timeout detected" trendUp={false} iconColor={DH.danger} />
        <StatCard icon={<AlertTriangle className="h-5 w-5" />} label="Degraded / Error" value={counts.alerts} trend="needs attention" trendUp={false} iconColor={DH.warning} />
      </div>

      {/* Device table */}
      <div className="rounded-2xl border" style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4" style={{ borderColor: DH.border }}>
          <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>All Devices</h3>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color: DH.textSecondary }} />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search device / zone…"
                className="h-8 w-[200px] rounded-lg border-slate-700 bg-slate-800/50 pl-8 text-[12px] text-slate-100 placeholder:text-slate-500"
              />
            </div>
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger className="h-8 w-[120px] rounded-lg border-slate-700 bg-slate-800/50 text-[12px] text-slate-200">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                {["ALL", "ONLINE", "OFFLINE", "DEGRADED", "MAINTENANCE", "PROVISIONED", "RETIRED"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-[150px] rounded-lg border-slate-700 bg-slate-800/50 text-[12px] text-slate-200">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                <SelectItem value="ALL">All types</SelectItem>
                {types.map((t: string) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {user?.role === "ADMIN" && (
              <Button size="sm" className="h-8 gap-1.5 rounded-lg text-[12px]" style={{ backgroundColor: DH.accent }} onClick={() => setProvisionOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Provision Device
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b" style={{ borderColor: DH.border }}>
                {["Device", "Type", "Zone", "Status", "Health", "Last Seen", "Temperature", "Power", "Actions"].map((h) => (
                  <th key={h} className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider" style={{ color: DH.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="px-4 py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" style={{ color: DH.textSecondary }} /></td></tr>
              )}
              {!isLoading && devices.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState title="No devices match the filters" subtitle="Adjust state/type filters or search term" />
                  </td>
                </tr>
              )}
              {devices.map((d: any) => (
                <tr
                  key={d.deviceId}
                  className="cursor-pointer border-b transition-colors hover:bg-slate-700/25"
                  style={{ borderColor: `${DH.border}88` }}
                  onClick={() => openDevice(d.deviceId)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold" style={{ color: DH.textPrimary }}>{d.name}</span>
                      {d.simulator && <SimulatorBadge />}
                    </div>
                    <div className="text-[11px] font-mono" style={{ color: DH.textSecondary }}>{d.deviceId} · fw {d.firmwareVersion}</div>
                  </td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: DH.textSecondary }}>{d.type}</td>
                  <td className="px-4 py-3 text-[12px]" style={{ color: DH.textSecondary }}>{d.zone || "—"}</td>
                  <td className="px-4 py-3"><StatusPill label={d.state} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <ProgressBar percent={d.health} color={healthColor(d.health)} height={5} className="w-16" />
                      <span className="text-[11.5px] font-semibold tabular-nums" style={{ color: DH.textPrimary }}>{d.health}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[11px]" style={{ color: DH.textSecondary }}>{timeAgo(d.lastSeenAt)}</td>
                  <td className="px-4 py-3">
                    {d.temperature ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: d.temperature.value > 85 ? DH.danger : DH.textPrimary }}>
                        <Thermometer className="h-3 w-3" /> {fmtVal(d.temperature.value, "°C")}
                      </span>
                    ) : <span className="text-[12px]" style={{ color: DH.textSecondary }}>—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {d.power ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: DH.textPrimary }}>
                        <Zap className="h-3 w-3" /> {fmtVal(d.power.value, "kW")}
                      </span>
                    ) : <span className="text-[12px]" style={{ color: DH.textSecondary }}>—</span>}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <button className="rounded-lg p-1.5 hover:bg-slate-700/50" style={{ color: DH.textSecondary }}>
                      <MoreVertical className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ProvisionDialog open={provisionOpen} onClose={() => setProvisionOpen(false)} />
    </div>
  );
}

function ProvisionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("ENV_SENSOR");
  const [zone, setZone] = useState("");
  const [profile, setProfile] = useState("STABLE");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, type, zone, profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      toast({ title: "Device provisioned", description: `${data.device.deviceId} registered — the simulator will connect it automatically` });
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      onClose();
      setName(""); setZone("");
    },
    onError: (e: any) => toast({ title: "Provisioning failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="border-slate-700 bg-[#151E2D] sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-slate-100">Provision New Device</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Device name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Environmental Sensor 004" className="border-slate-700 bg-slate-800/60 text-slate-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                  {["ENV_SENSOR", "TEMP_HUM", "MOTION", "POWER_METER", "VIBRATION", "VOLTAGE", "STATUS"].map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-slate-400">Simulator profile</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger className="border-slate-700 bg-slate-800/60 text-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent className="border-slate-700 bg-[#151E2D] text-slate-200">
                  {["STABLE", "GRADUAL_DRIFT", "THRESHOLD_VIOLATION", "INTERMITTENT", "SENSOR_FAULT", "STALE"].map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[12px] text-slate-400">Zone / location</Label>
            <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="e.g. Assembly Line 1" className="border-slate-700 bg-slate-800/60 text-slate-100" />
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            The device is registered as origin=SIMULATOR with a deterministic seed. The simulator service picks it up automatically and begins MQTT telemetry.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-slate-700 bg-transparent text-slate-300">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !name.trim()} style={{ backgroundColor: DH.accent }}>
            {mutation.isPending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            Provision
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
