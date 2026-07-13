"use client";
import { useEffect, useRef } from "react";

// The signature: a live PPI sonar scope, drawn by hand on one canvas.
//
// - The sweep beam rotates with phosphor persistence (the frame is never
//   cleared; it is washed with a translucent abyss fill, so light decays).
// - Echo blips are REAL data: the latest thesis's ETF-flow signals, fetched
//   from the public API (magnitude -> range + size, asset -> bearing, inflow
//   solid / outflow hollow). A fixture keeps the hero alive if the API is down.
// - Scroll drives a pseudo-3D tilt: the flat scope opens into a receding depth
//   cone (each ring rises and flattens as you dive). Projection is ~40 lines of
//   ellipse math; no WebGL, no dependencies.
// - Pauses when the tab is hidden. Under prefers-reduced-motion it draws one
//   static frame and never animates.

type Blip = {
  bearing: number; // radians
  range: number; // 0..1 of scope radius
  size: number; // px at DPR 1
  hollow: boolean; // outflow
  energy: number; // phosphor excitement, decays
  label: string;
};

const FIXTURE: Array<{ asset: string; magnitudeUSD: number; direction: string }> = [
  { asset: "BTC", magnitudeUSD: 3_100_000_000, direction: "inflow" },
  { asset: "ETH", magnitudeUSD: 900_000_000, direction: "inflow" },
  { asset: "SOL", magnitudeUSD: 240_000_000, direction: "outflow" },
  { asset: "XRP", magnitudeUSD: 120_000_000, direction: "inflow" },
  { asset: "DOGE", magnitudeUSD: 60_000_000, direction: "outflow" },
];

const ASSET_BEARINGS: Record<string, number> = {
  BTC: -0.42,
  ETH: 2.3,
  SOL: 3.4,
  XRP: 1.25,
  DOGE: 4.3,
  LINK: 5.2,
  AVAX: 0.6,
};

function toBlips(
  signals: Array<{ asset: string; magnitudeUSD: number; direction: string }>,
): Blip[] {
  // Range by log magnitude: $10M hugs the center, $5B reaches the rim.
  const seen = new Map<string, Blip>();
  for (const s of signals) {
    const mag = Math.max(1e7, Math.abs(s.magnitudeUSD));
    const t = Math.min(1, (Math.log10(mag) - 7) / 2.7); // 1e7..~5e9
    const bearing =
      ASSET_BEARINGS[s.asset] ?? (s.asset.charCodeAt(0) % 7) * 0.9;
    const existing = seen.get(s.asset);
    const blip: Blip = {
      bearing,
      range: 0.3 + t * 0.62,
      size: 2.6 + t * 3.2,
      hollow: s.direction === "outflow",
      energy: 0,
      label: s.asset,
    };
    if (!existing || blip.range > existing.range) seen.set(s.asset, blip);
  }
  return [...seen.values()];
}

export function SonarScope() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const PING = "233, 186, 77"; // rgb of --ping
    const ABYSS = "11, 16, 31";

    let blips: Blip[] = toBlips(FIXTURE);
    let raf = 0;
    let running = true;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let beam = -Math.PI / 4;
    let tilt = 0; // eased scroll progress 0..1
    let targetTilt = 0;
    let boot = 0; // 0..1 boot-up scale
    let last = performance.now();

    fetch("/api/v1/thesis/latest", { headers: { Accept: "application/json" } })
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { thesis?: { signals?: { etfFlowSignal?: Array<{ asset: string; magnitudeUSD: number; direction: string }> } } } }) => {
        const sig = j?.data?.thesis?.signals?.etfFlowSignal;
        if (j?.ok && sig && sig.length > 0) blips = toBlips(sig);
      })
      .catch(() => undefined);

    function resize() {
      if (!canvas) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Fresh abyss after a resize so stale trails do not smear.
      ctx!.fillStyle = `rgb(${ABYSS})`;
      ctx!.fillRect(0, 0, width, height);
    }

    function onScroll() {
      const span = Math.max(1, window.innerHeight * 2.4);
      targetTilt = Math.min(1, window.scrollY / span);
    }

    // Cone projection: ring of radius r sits on an ellipse squashed by the
    // tilt; smaller rings rise toward the apex as the cone opens.
    function ringGeom(r: number, R: number, cx: number, cy: number) {
      const squash = 1 - 0.62 * tilt;
      const y = cy - (R - r) * 0.9 * tilt;
      return { cx, cy: y, rx: r, ry: r * squash };
    }

    function project(
      range: number,
      bearing: number,
      R: number,
      cx: number,
      cy: number,
    ) {
      const g = ringGeom(range * R, R, cx, cy);
      return {
        x: g.cx + g.rx * Math.cos(bearing),
        y: g.cy + g.ry * Math.sin(bearing),
      };
    }

    function frame(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;

      boot = Math.min(1, boot + dt / 1.1);
      const bootEase = 1 - Math.pow(1 - boot, 3);
      tilt += (targetTilt - tilt) * Math.min(1, dt * 6);
      beam += dt * 0.55;

      // Phosphor decay wash instead of a clear.
      ctx!.fillStyle = `rgba(${ABYSS}, 0.16)`;
      ctx!.fillRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * (0.46 + 0.1 * tilt);
      const R = Math.min(width, height) * 0.44 * bootEase;
      if (R < 2) {
        raf = requestAnimationFrame(frame);
        return;
      }

      // The instrument yields to the text as you dive: dim with tilt so strata
      // paragraphs stay legible over the cone.
      drawScope(cx, cy, R, beam, bootEase * (1 - 0.45 * tilt));
      raf = requestAnimationFrame(frame);
    }

    function drawScope(
      cx: number,
      cy: number,
      R: number,
      beamAngle: number,
      alpha: number,
    ) {
      // Range rings, outermost brightest.
      const rings = [1, 0.78, 0.56, 0.34, 0.14];
      rings.forEach((f, i) => {
        const g = ringGeom(f * R, R, cx, cy);
        ctx!.beginPath();
        ctx!.ellipse(g.cx, g.cy, g.rx, g.ry, 0, 0, Math.PI * 2);
        ctx!.strokeStyle = `rgba(${PING}, ${(0.34 - i * 0.055) * alpha})`;
        ctx!.lineWidth = i === 0 ? 1.4 : 1;
        ctx!.stroke();
      });

      // Bearing ticks on the outer ring.
      const outer = ringGeom(R, R, cx, cy);
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const x1 = outer.cx + outer.rx * Math.cos(a);
        const y1 = outer.cy + outer.ry * Math.sin(a);
        const x2 = outer.cx + outer.rx * 0.97 * Math.cos(a);
        const y2 = outer.cy + outer.ry * 0.97 * Math.sin(a);
        ctx!.beginPath();
        ctx!.moveTo(x1, y1);
        ctx!.lineTo(x2, y2);
        ctx!.strokeStyle = `rgba(${PING}, ${(i % 6 === 0 ? 0.4 : 0.16) * alpha})`;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      // The beam: a fan of decaying rays behind the needle, projected onto the
      // cone so the sweep bends with the tilt.
      const apex = ringGeom(0, R, cx, cy);
      const RAYS = 26;
      for (let i = 0; i < RAYS; i++) {
        const a = beamAngle - (i / RAYS) * 0.8;
        const p = project(1, a, R, cx, cy);
        ctx!.beginPath();
        ctx!.moveTo(apex.cx, apex.cy);
        ctx!.lineTo(p.x, p.y);
        ctx!.strokeStyle = `rgba(${PING}, ${0.11 * (1 - i / RAYS) * alpha})`;
        ctx!.lineWidth = i === 0 ? 1.6 : 1;
        ctx!.stroke();
      }

      // Blips: excite when the beam passes, then decay.
      for (const b of blips) {
        const diff = Math.atan2(
          Math.sin(beamAngle - b.bearing),
          Math.cos(beamAngle - b.bearing),
        );
        if (diff > 0 && diff < 0.12) b.energy = 1;
        b.energy = Math.max(0.22, b.energy * 0.985);

        const p = project(b.range, b.bearing, R, cx, cy);
        const e = b.energy * alpha;
        const halo = ctx!.createRadialGradient(
          p.x,
          p.y,
          0,
          p.x,
          p.y,
          b.size * 5,
        );
        halo.addColorStop(0, `rgba(${PING}, ${0.5 * e})`);
        halo.addColorStop(1, `rgba(${PING}, 0)`);
        ctx!.fillStyle = halo;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, b.size * 5, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.beginPath();
        ctx!.arc(p.x, p.y, b.size, 0, Math.PI * 2);
        if (b.hollow) {
          ctx!.strokeStyle = `rgba(${PING}, ${Math.min(1, 0.5 + e)})`;
          ctx!.lineWidth = 1.6;
          ctx!.stroke();
        } else {
          ctx!.fillStyle = `rgba(${PING}, ${Math.min(1, 0.5 + e)})`;
          ctx!.fill();
        }
      }

      // Apex pip.
      ctx!.beginPath();
      ctx!.arc(apex.cx, apex.cy, 2.2, 0, Math.PI * 2);
      ctx!.fillStyle = `rgba(${PING}, ${0.9 * alpha})`;
      ctx!.fill();
    }

    resize();
    window.addEventListener("resize", resize);

    if (reduced) {
      // One static frame: booted scope, beam at rest, blips lit.
      boot = 1;
      tilt = 0;
      ctx.fillStyle = `rgb(${ABYSS})`;
      ctx.fillRect(0, 0, width, height);
      for (const b of blips) b.energy = 0.7;
      drawScope(width / 2, height * 0.46, Math.min(width, height) * 0.44, -Math.PI / 4, 1);
      // Redraw with fresh data once the fetch lands.
      const t = setTimeout(() => {
        ctx.fillStyle = `rgb(${ABYSS})`;
        ctx.fillRect(0, 0, width, height);
        for (const b of blips) b.energy = 0.7;
        drawScope(width / 2, height * 0.46, Math.min(width, height) * 0.44, -Math.PI / 4, 1);
      }, 1500);
      return () => {
        clearTimeout(t);
        window.removeEventListener("resize", resize);
      };
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    const onVisibility = () => {
      running = document.visibilityState === "visible";
      if (running) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full"
    />
  );
}
