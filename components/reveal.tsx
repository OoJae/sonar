"use client";
import { useEffect, useRef } from "react";

// Reveal choreography: adds .in to every .rv / .rv-fade inside this wrapper
// the first time it approaches the viewport. The transitions themselves live
// in globals.css (masked line slides, expressive-out easing, reduced-motion
// fallback); stagger comes from inline transition-delay set in markup.
export function Reveal({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const targets = el.querySelectorAll(".rv, .rv-fade");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            targets.forEach((t) => t.classList.add("in"));
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
