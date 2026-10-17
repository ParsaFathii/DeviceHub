/**
 * DeviceHub — IoT Device Management, Edge Gateway, Telemetry Analytics and Local AI Platform
 * Web application entry point.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useEffect, useState } from "react";
import { useDhStore } from "@/lib/store";
import { LoginScreen } from "@/components/devicehub/login";
import { Shell } from "@/components/devicehub/shell";
import { Loader2 } from "lucide-react";

export default function Home() {
  const user = useDhStore((s) => s.user);
  const setUser = useDhStore((s) => s.setUser);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // restore session on refresh
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user || null))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, [setUser]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: "linear-gradient(135deg, #1d4ed8 0%, #0f172a 55%, #4c1d95 100%)" }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-white/80" />
          <span className="text-[12px] font-medium text-white/70">DeviceHub — restoring session…</span>
        </div>
      </div>
    );
  }

  if (!user) return <LoginScreen />;
  return <Shell />;
}
