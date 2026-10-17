/**
 * DeviceHub shared UI primitives — design tokens from the approved UI mockups.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

// ---- Design tokens (from the approved industrial dark UI) ------------------
export const DH = {
  bg: "#0B1120",
  surface: "#151E2D",
  surfaceHover: "#1E293B",
  border: "#1E293B",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  accent: "#3B82F6",
  cyan: "#22D3EE",
  purple: "#8B5CF6",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
};

export function stateColor(state: string): string {
  switch (state) {
    case "ONLINE":
    case "ACTIVE":
    case "SUCCEEDED":
    case "up":
    case "COMPLETED":
    case "DRAINED":
    case "CONNECTED":
      return DH.success;
    case "DEGRADED":
    case "MAINTENANCE":
    case "BUFFERING":
    case "WARNING":
    case "ACKNOWLEDGED":
    case "QUEUED":
    case "SENT":
    case "DRAINING":
      return DH.warning;
    case "OFFLINE":
    case "ERROR":
    case "FAILED":
    case "CRITICAL":
    case "EXPIRED":
    case "RETIRED":
    case "down":
      return DH.danger;
    case "REQUESTED":
    case "AUTHORIZED":
    case "PROVISIONED":
      return DH.accent;
    default:
      return DH.textSecondary;
  }
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "CRITICAL":
      return DH.danger;
    case "WARNING":
      return DH.warning;
    case "INFO":
      return DH.accent;
    default:
      return DH.textSecondary;
  }
}

// ---- Status pill -------------------------------------------------------------
export function StatusPill({ label, color, dot = true }: { label: string; color?: string; dot?: boolean }) {
  const c = color || stateColor(label);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
      style={{ color: c, backgroundColor: `${c}18`, border: `1px solid ${c}33` }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />}
      {label}
    </span>
  );
}

// ---- KPI stat card -----------------------------------------------------------
export function StatCard({
  icon,
  label,
  value,
  unit,
  trend,
  trendUp,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  trendUp?: boolean;
  iconColor?: string;
}) {
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border p-5 transition-all hover:border-slate-600"
      style={{ backgroundColor: DH.surface, borderColor: DH.border }}
    >
      <div className="flex items-start justify-between">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${iconColor || DH.accent}1a`, color: iconColor || DH.accent }}
        >
          {icon}
        </div>
        <MoreHorizontal className="h-4 w-4 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-3 text-[12px] font-medium" style={{ color: DH.textSecondary }}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[30px] font-bold leading-none tracking-tight" style={{ color: DH.textPrimary }}>
          {value}
        </span>
        {unit && <span className="text-[13px] font-medium" style={{ color: DH.textSecondary }}>{unit}</span>}
      </div>
      {trend && (
        <div className="mt-2.5">
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
            style={{
              color: trendUp ? DH.success : DH.danger,
              backgroundColor: trendUp ? `${DH.success}15` : `${DH.danger}15`,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={trendUp ? "" : "rotate-180"}>
              <path d="M6 10V2M6 2L2.5 5.5M6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {trend}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Section card ------------------------------------------------------------
export function SectionCard({
  title,
  action,
  children,
  className,
  icon,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-2xl border", className)} style={{ backgroundColor: DH.surface, borderColor: DH.border }}>
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: DH.border }}>
        <div className="flex items-center gap-2.5">
          {icon && <span style={{ color: DH.accent }}>{icon}</span>}
          <h3 className="text-[15px] font-semibold" style={{ color: DH.textPrimary }}>
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ---- Donut chart -------------------------------------------------------------
export function DonutChart({
  percent,
  color,
  label,
  sublabel,
  size = 120,
}: {
  percent: number;
  color: string;
  label: string;
  sublabel?: string;
  size?: number;
}) {
  const data = [
    { name: "v", value: Math.max(0, Math.min(100, percent)) },
    { name: "rest", value: Math.max(0, 100 - percent) },
  ];
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            innerRadius="72%"
            outerRadius="95%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            cornerRadius={6}
          >
            <Cell fill={color} />
            <Cell fill={DH.surfaceHover} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[20px] font-bold" style={{ color: DH.textPrimary }}>
          {label}
        </span>
        {sublabel && (
          <span className="text-[10px] font-medium" style={{ color: DH.textSecondary }}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Small helpers -----------------------------------------------------------
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "soon";
  const s = Math.round(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function fmtTs(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", { hour12: false });
}

export function fmtVal(v: number | null | undefined, unit?: string): string {
  if (v === null || v === undefined) return "—";
  const s = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${s}${unit ? ` ${unit}` : ""}`;
}

// ---- Empty / loading states --------------------------------------------------
export function EmptyState({ icon, title, subtitle }: { icon?: React.ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div style={{ color: DH.textSecondary, opacity: 0.5 }}>{icon}</div>}
      <div className="text-[14px] font-medium" style={{ color: DH.textSecondary }}>{title}</div>
      {subtitle && <div className="text-[12px]" style={{ color: DH.textSecondary, opacity: 0.7 }}>{subtitle}</div>}
    </div>
  );
}

export function SimulatorBadge({ label = "SIMULATOR" }: { label?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wider"
      style={{ color: DH.purple, backgroundColor: `${DH.purple}18`, border: `1px solid ${DH.purple}30` }}
    >
      {label}
    </span>
  );
}
