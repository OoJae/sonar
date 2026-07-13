import { ImageResponse } from "next/og";

// Social card: the scope mid-sweep + the wordmark. Rendered by Next/Satori at
// request time from brand tokens; no image pipeline. Satori supports a CSS
// subset (flex, absolute, borders, radial-gradient), so the sweep is a rotated
// needle bar rather than a conic wedge.

export const runtime = "nodejs";
export const alt = "Sonar: an instrument for finding signal in deep water";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const PING = "#E9BA4D";
const INK = "#F2F4F8";
const ABYSS = "#0B101F";

function Ring({ r, opacity }: { r: number; opacity: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: -r,
        top: -r,
        width: r * 2,
        height: r * 2,
        borderRadius: "50%",
        border: `2px solid ${PING}`,
        opacity,
        display: "flex",
      }}
    />
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          background: ABYSS,
          display: "flex",
          position: "relative",
          fontFamily: "sans-serif",
        }}
      >
        {/* scope, right side, bleeding off-canvas */}
        <div
          style={{
            position: "absolute",
            left: 880,
            top: 315,
            display: "flex",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: -290,
              top: -290,
              width: 580,
              height: 580,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(233,186,77,0.14) 0%, rgba(233,186,77,0.03) 55%, rgba(233,186,77,0) 75%)",
              display: "flex",
            }}
          />
          <Ring r={270} opacity={0.85} />
          <Ring r={185} opacity={0.5} />
          <Ring r={100} opacity={0.3} />
          {/* needle, blip, and pip as inline SVG: deterministic geometry from
              the true center (Satori transform-origin drifts). */}
          <svg
            width={580}
            height={580}
            viewBox="0 0 580 580"
            style={{ position: "absolute", left: -290, top: -290 }}
          >
            <line
              x1={290}
              y1={290}
              x2={480.9}
              y2={99.1}
              stroke={PING}
              strokeWidth={4}
              strokeLinecap="round"
            />
            <circle cx={475.4} cy={215.1} r={9} fill={PING} />
            <circle cx={290} cy={290} r={6} fill={PING} />
          </svg>
        </div>

        {/* wordmark + tagline, left */}
        <div
          style={{
            position: "absolute",
            left: 72,
            top: 178,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 104,
              fontWeight: 700,
              letterSpacing: 26,
              color: INK,
              display: "flex",
            }}
          >
            SONAR
          </div>
          <div
            style={{
              marginTop: 18,
              fontSize: 34,
              color: PING,
              display: "flex",
              maxWidth: 620,
            }}
          >
            An instrument for finding signal in deep water.
          </div>
          <div
            style={{
              marginTop: 34,
              fontSize: 20,
              letterSpacing: 5,
              color: "rgba(242,244,248,0.55)",
              display: "flex",
            }}
          >
            CITED THESES / VERIFIABLE TRACK RECORD / SONAR.MY.ID
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
