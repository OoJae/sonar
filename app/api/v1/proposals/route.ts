import { listProposals } from "@/lib/proposals/store";
import { computeArena } from "@/lib/proposals/arena";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Custom index proposals (design artifacts with pricing coverage) plus their
// forward-test arena state (indexed curve since creation, return-since).
// Read-only; creation stays on POST /api/proposals.
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const proposals = await listProposals();
    const arena = await computeArena(proposals.map((p) => p.id));
    return v1Json({
      proposals: proposals.map((p) => ({
        ...p,
        forwardTest: arena.get(p.id) ?? null,
      })),
    });
  } catch {
    return v1Error("database_unavailable");
  }
}
