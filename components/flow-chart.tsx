"use client";
import { useState } from "react";

type Point = { date: string; value: number };

// Pure-SVG bar chart. Replaces Recharts here because Recharts 3.8 +
// ResponsiveContainer + React 19 + Next 16 Turbopack consistently rendered an
// empty 0x0 placeholder that never re-measured on hydration. With ~21 daily
// data points per asset this is cheaper anyway.
export function FlowChart({ data }: { data: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="h-48 w-full flex items-center justify-center mono text-[11px] text-muted-foreground">
        no data
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

  const values = data.map((d) => d.value);
  const dataMax = Math.max(0, ...values);
  const dataMin = Math.min(0, ...values);
  const range = dataMax - dataMin || 1;
  const yToPx = (v: number) =>
    PAD_T + plotH * (1 - (v - dataMin) / range);
  const zeroY = yToPx(0);

  const barW = plotW / data.length;
  const gap = Math.min(2, barW * 0.18);
  const innerW = Math.max(barW - gap, 1);

  const yTicks = makeYTicks(dataMin, dataMax, 4);

  return (
    <div className="h-48 w-full">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        width="100%"
        height="100%"
        role="img"
        aria-label="ETF net flows by session"
      >
        {yTicks.map((t, i) => (
          <g key={`yt-${i}`}>
            <line
              x1={PAD_L}
              x2={VIEW_W - PAD_R}
              y1={yToPx(t)}
              y2={yToPx(t)}
              stroke="var(--border)"
              strokeWidth={t === 0 ? 1.2 : 0.6}
              opacity={t === 0 ? 0.9 : 0.35}
            />
            <text
              x={PAD_L - 6}
              y={yToPx(t) + 3}
              textAnchor="end"
              fontFamily="var(--font-mono)"
              fontSize={10}
              fill="var(--muted-foreground)"
            >
              {compactUSD(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const x = PAD_L + i * barW + gap / 2;
          const top = d.value >= 0 ? yToPx(d.value) : zeroY;
          const h = Math.max(Math.abs(yToPx(d.value) - zeroY), 1);
          const fill =
            d.value >= 0 ? "var(--positive)" : "var(--negative)";
          return (
            <g key={`b-${i}`}>
              <rect
                x={x}
                y={top}
                width={innerW}
                height={h}
                fill={fill}
                opacity={hover === null || hover === i ? 1 : 0.45}
                rx={1.5}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}

        {data.map((d, i) => {
          // every ~5th label, plus the last one
          const show = i % 5 === 0 || i === data.length - 1;
          if (!show) return null;
          const x = PAD_L + i * barW + barW / 2;
          return (
            <text
              key={`xt-${i}`}
              x={x}
              y={VIEW_H - 6}
              textAnchor="middle"
              fontFamily="var(--font-mono)"
              fontSize={9}
              fill="var(--muted-foreground)"
            >
              {d.date}
            </text>
          );
        })}

        {hover !== null && data[hover] && (
          <g>
            <rect
              x={PAD_L + hover * barW - 0.5}
              y={PAD_T - 6}
              width={Math.max(barW + 1, 2)}
              height={plotH + 12}
              fill="oklch(1 0 0 / 6%)"
              pointerEvents="none"
            />
            <rect
              x={Math.min(PAD_L + hover * barW + 8, VIEW_W - 96)}
              y={PAD_T}
              width={88}
              height={32}
              fill="var(--card)"
              stroke="var(--border)"
              rx={4}
              pointerEvents="none"
            />
            <text
              x={Math.min(PAD_L + hover * barW + 16, VIEW_W - 88)}
              y={PAD_T + 13}
              fontFamily="var(--font-mono)"
              fontSize={10}
              fill="var(--muted-foreground)"
              pointerEvents="none"
            >
              {data[hover]?.date}
            </text>
            <text
              x={Math.min(PAD_L + hover * barW + 16, VIEW_W - 88)}
              y={PAD_T + 26}
              fontFamily="var(--font-mono)"
              fontSize={11}
              fill="var(--foreground)"
              pointerEvents="none"
            >
              {compactUSD(data[hover]?.value ?? 0)}
            </text>
          </g>
        )}
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
  if (min < 0 && max > 0 && !ticks.includes(0)) ticks.push(0);
  return ticks;
}

function compactUSD(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
}
