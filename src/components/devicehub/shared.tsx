/**
 * DeviceHub shared UI primitives — design tokens from the approved UI mockups.
 * v2 refinement pass: tabular figures, gradient icon chips, gauge rings with
 * rounded caps + arc gap + gradient stroke, glow accents, refined pills.
 * Copyright © 2026 Parsa Fathi — Apache-2.0
 */
"use client";
import { useEffect, useId, useState } from "react";
import { cn } from "@/lib/utils";
import { MoreHorizontal } from "lucide-react";

// ---- Design tokens (from the approved industrial dark UI) ------------------
export const DH = {
  bg: "#0B1120",
  surface: "#151E2D",
  surfaceHover: "#1E293B",
  border: "#1E293B",
  borderSoft: "rgba(148,163,184,0.10)",
  borderFaint: "rgba(148,163,184,0.07)",
  textPrimary: "#F8FAFC",
  textSecondary: "#94A3B8",
  accent: "#3B82F6",
  cyan: "#22D3EE",
  purple: "#8B5CF6",
  success: "#10B981",
  warning: "#F59E0B",
  danger: "#EF4444",
};

// ---- color helpers ----------------------------------------------------------
export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

/** mix a hex color toward white (t > 0) or black (t < 0) */
export function mix(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const to = t >= 0 ? 255 : 0;
  const k = Math.abs(t);
  const c = (x: number) => Math.round(x + (to - x) * k);
  return `#${[c(r), c(g), c(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

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

/** semantic health → color (used by rings, bars, percentages) */
export function healthColor(health: number): string {
  return health > 80 ? DH.success : health > 60 ? DH.warning : DH.danger;
}

// ---- Status pill -------------------------------------------------------------
export function StatusPill({ label, color, dot = true }: { label: string; color?: string; dot?: boolean }) {
  const c = color || stateColor(label);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide"
      style={{ color: c, backgroundColor: rgba(c, 0.09), border: `1px solid ${rgba(c, 0.22)}` }}
    >
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: c, boxShadow: `0 0 6px ${rgba(c, 0.8)}` }}
        />
      )}
      {label}
    </span>
  );
}

// ---- KPI stat card (v2: heavy tabular value, gradient icon chip, glow) ------
export function StatCard({
  icon,
  label,
  value,
  unit,
  trend,
  trendUp,
  trendNeutral,
  iconColor,
  valueSuffix,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  unit?: string;
  trend?: string;
  trendUp?: boolean;
  trendNeutral?: boolean;
  iconColor?: string;
  valueSuffix?: string;
}) {
  const c = iconColor || DH.accent;
  const trendColor = trendNeutral ? DH.textSecondary : trendUp ? DH.success : DH.danger;
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5"
      style={{
        backgroundColor: DH.surface,
        borderColor: DH.borderSoft,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -16px rgba(0,0,0,0.8)",
      }}
    >
      {/* soft corner glow */}
      <div
        className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-40 blur-2xl transition-opacity duration-300 group-hover:opacity-70"
        style={{ background: `radial-gradient(circle, ${rgba(c, 0.22)} 0%, transparent 70%)` }}
      />
      <div className="flex items-start justify-between">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-xl"
          style={{
            background: `linear-gradient(135deg, ${rgba(c, 0.20)} 0%, ${rgba(c, 0.08)} 100%)`,
            border: `1px solid ${rgba(c, 0.25)}`,
            color: c,
            boxShadow: `inset 0 1px 0 ${rgba(c, 0.18)}`,
          }}
        >
          {icon}
        </div>
        <MoreHorizontal className="h-4 w-4 text-slate-600 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className="mt-3.5 text-[12px] font-medium" style={{ color: DH.textSecondary }}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className="text-[34px] font-bold leading-none tracking-tight tabular-nums"
          style={{ color: DH.textPrimary, textShadow: "0 2px 12px rgba(148,163,184,0.15)" }}
        >
          {value}
        </span>
        {unit && <span className="text-[14px] font-semibold" style={{ color: DH.textSecondary }}>{unit}</span>}
        {valueSuffix && (
          <span className="text-[16px] font-bold" style={{ color: DH.textSecondary }}>{valueSuffix}</span>
        )}
      </div>
      {trend && (
        <div className="mt-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums"
            style={{
              color: trendNeutral ? DH.textSecondary : trendColor,
              backgroundColor: trendNeutral ? rgba(DH.textSecondary, 0.07) : rgba(trendColor, 0.10),
              border: `1px solid ${trendNeutral ? rgba(DH.textSecondary, 0.12) : rgba(trendColor, 0.20)}`,
            }}
          >
            {!trendNeutral && (
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" className={trendUp ? "" : "rotate-180"}>
                <path d="M6 10V2M6 2L2.5 5.5M6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {trend}
          </span>
        </div>
      )}
    </div>
  );
}

// ---- Section card (v2: icon chip, soft border, inset highlight) -------------
export function SectionCard({
  title,
  action,
  children,
  className,
  icon,
  iconColor,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
  iconColor?: string;
}) {
  const c = iconColor || DH.accent;
  return (
    <div
      className={cn("rounded-2xl border", className)}
      style={{
        backgroundColor: DH.surface,
        borderColor: DH.borderSoft,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 24px -18px rgba(0,0,0,0.8)",
      }}
    >
      <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: DH.borderFaint }}>
        <div className="flex items-center gap-2.5">
          {icon && (
            <span
              className="flex h-7 w-7 items-center justify-center rounded-lg"
              style={{ background: rgba(c, 0.12), border: `1px solid ${rgba(c, 0.20)}`, color: c }}
            >
              {icon}
            </span>
          )}
          <h3 className="text-[15px] font-semibold tracking-tight" style={{ color: DH.textPrimary }}>
            {title}
          </h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ---- Gauge ring (v2: SVG arc, rounded caps, gradient, glow, gap notch) ------
/**
 * Circular gauge matching the approved mockups:
 *  - 270° sweep with a bottom notch (gap between arc end and track start)
 *  - thick rounded-cap stroke (~16% of diameter)
 *  - subtle gradient on the value arc (lighter → base)
 *  - soft glow under the value arc, animated fill on mount
 *  - center: large bold tabular value + optional smaller "%" + sublabel
 */
export function GaugeRing({
  percent,
  color,
  label,
  sublabel,
  size = 96,
  thickness,
  animate = true,
  valueSuffix,
}: {
  percent: number;
  color: string;
  label: string | number;
  sublabel?: string;
  size?: number;
  thickness?: number;
  animate?: boolean;
  valueSuffix?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!animate) return;
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const pct = Math.max(0, Math.min(100, percent));
  const sw = thickness ?? Math.max(6, Math.round(size * 0.15));
  const r = (size - sw) / 2 - 1;
  const cx = size / 2;
  const cy = size / 2;
  const START = 135; // bottom-left
  const SWEEP = 270;

  const polar = (angleDeg: number): [number, number] => {
    const a = (angleDeg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arcPath = (from: number, to: number): string => {
    const [x1, y1] = polar(from);
    const [x2, y2] = polar(to);
    const large = to - from > 180 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  };

  const trackD = arcPath(START, START + SWEEP);
  const valueD = arcPath(START, START + SWEEP);
  const dash = animate ? (mounted ? pct / 100 : 0) : pct / 100;

  // center text: split trailing "%" so the symbol can be smaller (design detail)
  const labelText = String(label);
  const hasPct = labelText.endsWith("%");
  const centerValue = hasPct ? labelText.slice(0, -1) : labelText;
  const suffix = valueSuffix ?? (hasPct ? "%" : undefined);
  const valueFontSize = Math.round(size * 0.235);
  const subFontSize = Math.max(8.5, Math.round(size * 0.095));

  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${labelText} ${sublabel || ""}`}>
        <defs>
          <linearGradient id={`ring-${uid}`} x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={mix(color, 0.45)} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        {/* track */}
        <path
          d={trackD}
          fill="none"
          stroke={rgba(DH.surfaceHover, 0.75)}
          strokeWidth={sw}
          strokeLinecap="round"
        />
        {/* value arc — same geometry, revealed via dasharray (pathLength=1) */}
        <path
          d={valueD}
          fill="none"
          stroke={`url(#ring-${uid})`}
          strokeWidth={sw}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={`${dash.toFixed(4)} 1`}
          style={{
            filter: `drop-shadow(0 0 5px ${rgba(color, 0.55)})`,
            transition: "stroke-dasharray 900ms cubic-bezier(0.22,1,0.36,1)",
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="flex items-baseline">
          <span
            className="font-bold leading-none tabular-nums tracking-tight"
            style={{ color: DH.textPrimary, fontSize: valueFontSize }}
          >
            {centerValue}
          </span>
          {suffix && (
            <span className="ml-0.5 font-bold" style={{ color: DH.textSecondary, fontSize: Math.round(valueFontSize * 0.62) }}>
              {suffix}
            </span>
          )}
        </div>
        {sublabel && (
          <span className="mt-1 font-medium" style={{ color: DH.textSecondary, fontSize: subFontSize }}>
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}

// ---- Donut chart (legacy API preserved, now a refined gauge ring) -----------
export function DonutChart(props: {
  percent: number;
  color: string;
  label: string;
  sublabel?: string;
  size?: number;
}) {
  return <GaugeRing {...props} />;
}

// ---- Slim progress bar (v2: gradient fill + glow, design spec 6–8px pill) ---
export function ProgressBar({
  percent,
  color,
  height = 6,
  className,
  showGlow = true,
}: {
  percent: number;
  color: string;
  height?: number;
  className?: string;
  showGlow?: boolean;
}) {
  const pct = Math.max(0, Math.min(100, percent));
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full", className)}
      style={{ height, backgroundColor: rgba(DH.surfaceHover, 0.9) }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${mounted ? pct : 0}%`,
          background: `linear-gradient(90deg, ${mix(color, 0.35)} 0%, ${color} 100%)`,
          boxShadow: showGlow ? `0 0 8px ${rgba(color, 0.45)}` : undefined,
          transition: "width 900ms cubic-bezier(0.22,1,0.36,1)",
        }}
      />
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

/** integer with thousands separators, tabular-friendly */
export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
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
      style={{ color: DH.purple, backgroundColor: rgba(DH.purple, 0.09), border: `1px solid ${rgba(DH.purple, 0.20)}` }}
    >
      {label}
    </span>
  );
}
