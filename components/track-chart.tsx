"use client";
import { useState } from "react";

// Pure-SVG two-line cumulative chart: Sonar's rebalanced book (gold) versus a
// buy-and-hold baseline of the same index universe (muted), both indexed to 100
// at inception. Same approach as components/nav-chart.tsx (no Recharts).

export type TrackPoint = { at: string; book: number; baseline: number };

export function TrackChart({ data }: { data: TrackPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length < 2) {
    return (
      <div className="flex h-56 w-full items-center justify-center mono text-[11px] text-muted-foreground">
        accumulating track record (need at least two cycles)
      </div>
    );
  }

  const VIEW_W = 640;
  const VIEW_H = 224;
  const PAD_L = 52;
  const PAD_R = 12;
  const PAD_T = 14;
  const PAD_B = 26;
  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;

  const values = data.flatMap((d) => [d.book, d.baseline]);
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const span = dataMax - dataMin;
  const lo = dataMin - Math.max(span * 0.12, 0.05);
  const hi = dataMax + Math.max(span * 0.12, 0.05);
  const range = hi - lo || 1;

  const yToPx = (v: number) => PAD_T + plotH * (1 - (v - lo) / range);
  const xStep = data.length > 1 ? plotW / (data.length - 1) : 0;
  const xAt = (i: number) => PAD_L + i * xStep;

  const line = (key: "book" | "baseline") =>
    data
      .map((d, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yToPx(d[key]).toFixed(1)}`)
      .join(" ");

  const yTicks = makeYTicks(lo, hi, 4);

  return (
    <div className="h-56 w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        role="img"
        aria-label="Cumulative return: Sonar book vs buy-and-hold baseline"
      >
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={PAD_L}
              x2={VIEW_W - PAD_R}
              y1={yToPx(t)}
              y2={yToPx(t)}
              stroke="var(--border)"
              strokeWidth={t === 100 ? 1 : 0.6}
              opacity={t === 100 ? 0.7 : 0.3}
            />
            <text
              x={PAD_L - 6}
              y={yToPx(t) + 3}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {t.toFixed(1)}
            </text>
          </g>
        ))}

        {/* Baseline (muted) behind the book line. */}
        <path
          d={line("baseline")}
          fill="none"
          stroke="var(--muted-foreground)"
          strokeWidth={1.3}
          strokeDasharray="4 3"
          opacity={0.7}
          strokeLinejoin="round"
        />
        {/* Sonar book (gold accent). */}
        <path
          d={line("book")}
          fill="none"
          stroke="var(--gold, oklch(0.78 0.13 78))"
          strokeWidth={1.8}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {data.map((d, i) => (
          <circle
            key={`pt-${i}`}
            cx={xAt(i)}
            cy={yToPx(d.book)}
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
              x={Math.min(xAt(hover) + 8, VIEW_W - 150)}
              y={PAD_T}
              width={140}
              height={48}
              fill="var(--card)"
              stroke="var(--border)"
              rx={4}
            />
            <text x={Math.min(xAt(hover) + 16, VIEW_W - 142)} y={PAD_T + 14} fontFamily="var(--font-mono)" fontSize={10} fill="var(--muted-foreground)">
              {formatDate(data[hover]!.at)}
            </text>
            <text x={Math.min(xAt(hover) + 16, VIEW_W - 142)} y={PAD_T + 28} fontFamily="var(--font-mono)" fontSize={11} fill="var(--gold, oklch(0.78 0.13 78))">
              book {data[hover]!.book.toFixed(2)}
            </text>
            <text x={Math.min(xAt(hover) + 16, VIEW_W - 142)} y={PAD_T + 42} fontFamily="var(--font-mono)" fontSize={11} fill="var(--muted-foreground)">
              hold {data[hover]!.baseline.toFixed(2)}
            </text>
          </g>
        )}

        {data.map((d, i) => {
          const show = i === 0 || i === data.length - 1 || (data.length > 6 && i % Math.ceil(data.length / 5) === 0);
          if (!show) return null;
          return (
            <text key={`xt-${i}`} x={xAt(i)} y={VIEW_H - 8} textAnchor="middle" fontFamily="var(--font-mono)" fontSize={9} fill="var(--muted-foreground)">
              {formatDate(d.at)}
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
  for (let i = 0; i <= count; i++) ticks.push(min + ((max - min) * i) / count);
  if (min < 100 && max > 100 && !ticks.some((t) => Math.abs(t - 100) < 0.001)) ticks.push(100);
  return ticks;
}

function formatDate(iso: string): string {
  return iso.slice(5, 10);
}
