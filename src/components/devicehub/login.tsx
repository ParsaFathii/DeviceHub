/**
 * DeviceHub — login screen.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, ShieldCheck, Lock, User as UserIcon, Loader2 } from "lucide-react";
import { DH, SimulatorBadge } from "./shared";
import { useDhStore } from "@/lib/store";
import { useToast } from "@/hooks/use-toast";

const DEMO_ACCOUNTS = [
  { username: "admin", password: "admin123", role: "ADMIN — full administration" },
  { username: "operator", password: "operator123", role: "OPERATOR — commands & rules" },
  { username: "viewer", password: "viewer123", role: "VIEWER — read-only access" },
];

export function LoginScreen() {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setUser = useDhStore((s) => s.setUser);
  const { toast } = useToast();

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "login failed");
      setUser(data.user);
      toast({ title: `Welcome, ${data.user.name}`, description: `Signed in as ${data.user.role}` });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4" style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #0f172a 55%, #4c1d95 100%)" }}>
      <div className="w-full max-w-[420px] rounded-3xl border p-8 shadow-2xl" style={{ backgroundColor: DH.bg, borderColor: DH.border }}>
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl" style={{ backgroundColor: DH.accent }}>
            <Activity className="h-7 w-7 text-white" />
          </div>
          <div className="text-center">
            <h1 className="text-[22px] font-bold" style={{ color: DH.textPrimary }}>DeviceHub</h1>
            <p className="text-[12px]" style={{ color: DH.textSecondary }}>IoT Device Management · Edge Gateway · Telemetry Analytics</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="dh-user" className="text-[12px]" style={{ color: DH.textSecondary }}>Username</Label>
            <div className="relative">
              <UserIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: DH.textSecondary }} />
              <Input
                id="dh-user"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="pl-9 h-11 border-slate-700 bg-slate-800/60 text-slate-100 placeholder:text-slate-500"
                placeholder="username"
                autoComplete="username"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dh-pass" className="text-[12px]" style={{ color: DH.textSecondary }}>Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: DH.textSecondary }} />
              <Input
                id="dh-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9 h-11 border-slate-700 bg-slate-800/60 text-slate-100 placeholder:text-slate-500"
                placeholder="password"
                autoComplete="current-password"
              />
            </div>
          </div>
          {error && (
            <div className="rounded-lg px-3 py-2 text-[12px]" style={{ color: DH.danger, backgroundColor: `${DH.danger}15` }}>
              {error}
            </div>
          )}
          <Button type="submit" disabled={loading} className="h-11 w-full text-[14px] font-semibold" style={{ backgroundColor: DH.accent }}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Sign in to DeviceHub
          </Button>
        </form>

        <div className="mt-6 rounded-xl border p-3" style={{ borderColor: DH.border, backgroundColor: DH.surface }}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold" style={{ color: DH.textSecondary }}>Demo accounts (seeded)</span>
            <SimulatorBadge label="DEV ENVIRONMENT" />
          </div>
          {DEMO_ACCOUNTS.map((a) => (
            <button
              key={a.username}
              type="button"
              onClick={() => { setUsername(a.username); setPassword(a.password); }}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-slate-700/40"
            >
              <span className="font-mono" style={{ color: DH.textPrimary }}>{a.username} / {a.password}</span>
              <span style={{ color: DH.textSecondary }}>{a.role}</span>
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-[10px]" style={{ color: DH.textSecondary }}>
          Copyright © 2026 Parsa Fathi · Apache-2.0 · Fleet data originates from the deterministic simulator
        </p>
      </div>
    </div>
  );
}
