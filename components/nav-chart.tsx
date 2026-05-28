"use client";
import { useState } from "react";

// Pure-SVG NAV line chart. Same approach as components/flow-chart.tsx because
// Recharts 3.8 + ResponsiveContainer + React 19 + Next 16 Turbopack rendered
// an empty placeholder. With one snapshot per cycle the data set is small
// and the SVG path is trivial.
//
// One line per index per chart instance: the actual per-share NAV over time.
// A reference line at the inception value is drawn faint behind the active
// line as a visual baseline. A true "buy-and-hold the inception composition"
// baseline requires storing per-token prices at each snapshot, which is
// deferred; the inception reference still communicates "is Sonar tracking up,
// down, or flat from where it started."

export type NavPoint = { asOf: string; nav: number };

export function NavChart({
  data,
  label,
}: {
  data: NavPoint[];
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="h-48 w-full flex items-center justify-center mono text-[11px] text-muted-foreground">
        no nav snapshots yet
      </div>
    );
  }

  const VIEW_W = 600;
  const VIEW_H = 192;
  const PAD_L = 56;
  const PAD_R = 8;
  const PAD_T = 12;
  const PAD_B = 24;
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;

  const values = data.map((d) => d.nav);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  // Add a small visual buffer so a flat series does not collapse to a single
  // horizontal line on the top edge.
  const padFactor = 0.05;
  const span = dataMax - dataMin;
  const lo = dataMin - Math.max(span * padFactor, 0.0001);
  const hi = dataMax + Math.max(span * padFactor, 0.0001);
  const range = hi - lo || 1;

  const yToPx = (v: number) => PAD_T + plotH * (1 - (v - lo) / range);
  const inception = data[0]?.nav ?? 0;
  const inceptionY = yToPx(inception);

  const xStep = data.length > 1 ? plotW / (data.length - 1) : 0;
  const xAt = (i: number) =>
    data.length > 1 ? PAD_L + i * xStep : PAD_L + plotW / 2;

  const pathD = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yToPx(d.nav).toFixed(1)}`)
    .join(" ");

  const yTicks = makeYTicks(lo, hi, 4);

  return (
    <div className="h-48 w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        role="img"
        aria-label={`${label} per-share NAV over time`}
      >
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={PAD_L}
              x2={VIEW_W - PAD_R}
              y1={yToPx(t)}
              y2={yToPx(t)}
              stroke="var(--border)"
              strokeWidth={0.6}
              opacity={0.35}
            />
            <text
              x={PAD_L - 6}
              y={yToPx(t) + 3}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {formatNav(t)}
            </text>
          </g>
        ))}

        {/* Inception reference line. Faint dashed so it sits behind the active line. */}
        <line
          x1={PAD_L}
          x2={VIEW_W - PAD_R}
          y1={inceptionY}
          y2={inceptionY}
          stroke="var(--muted-foreground)"
          strokeDasharray="3 3"
          strokeWidth={0.8}
          opacity={0.6}
        />
        <text
          x={VIEW_W - PAD_R - 4}
          y={inceptionY - 4}
          textAnchor="end"
          fontFamily="var(--font-mono)"
          fontSize={9}
          fill="var(--muted-foreground)"
        >
          inception
        </text>

        {/* Actual NAV line in the brand gold accent. */}
        <path
          d={pathD}
          fill="none"
          stroke="var(--gold, oklch(0.78 0.13 78))"
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Points with hover affordances. */}
        {data.map((d, i) => (
          <circle
            key={`pt-${i}`}
            cx={xAt(i)}
            cy={yToPx(d.nav)}
            r={hover === i ? 4 : 2.5}
            fill="var(--gold, oklch(0.78 0.13 78))"
            stroke="var(--card)"
            strokeWidth={1}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: "pointer" }}
          />
        ))}

        {hover !== null && data[hover] && (
          <g pointerEvents="none">
            <rect
              x={Math.min(xAt(hover) + 8, VIEW_W - 110)}
              y={PAD_T}
              width={100}
              height={36}
              fill="var(--card)"
              stroke="var(--border)"
              rx={4}
            />
            <text
              x={Math.min(xAt(hover) + 16, VIEW_W - 102)}
              y={PAD_T + 14}
              fontFamily="var(--font-mono)"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {formatDate(data[hover]?.asOf ?? "")}
            </text>
            <text
              x={Math.min(xAt(hover) + 16, VIEW_W - 102)}
              y={PAD_T + 28}
              fontFamily="var(--font-mono)"
              fontSize={11}
              fill="var(--foreground)"
            >
              {formatNav(data[hover]?.nav ?? 0)}
            </text>
          </g>
        )}

        {data.map((d, i) => {
          const show = i === 0 || i === data.length - 1 || (data.length > 6 && i % Math.ceil(data.length / 5) === 0);
          if (!show) return null;
          return (
            <text
              key={`xt-${i}`}
              x={xAt(i)}
              y={VIEW_H - 6}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={9}
              fill="var(--muted-foreground)"
            >
              {formatDate(d.asOf)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function makeYTicks(min: number, max: number, count: number): number[] {
  if (max === min) return [min];
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) {
    ticks.push(min + ((max - min) * i) / count);
  }
  return ticks;
}

function formatNav(n: number): string {
  if (Math.abs(n) >= 100) return `$${n.toFixed(0)}`;
  if (Math.abs(n) >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  try {
    return iso.slice(5, 10);
  } catch {
    return iso;
  }
}
