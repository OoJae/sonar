"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/signals", label: "Signals" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/track", label: "Track" },
  { href: "/risk", label: "Risk" },
  { href: "/log", label: "Log" },
];

export function DashboardNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "mono rounded-md px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition-colors",
              active
                ? "bg-[color:var(--gold)]/10 text-[color:var(--gold)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
