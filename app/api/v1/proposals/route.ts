import { listProposals } from "@/lib/proposals/store";
import { v1RateLimit, v1Json, v1Error } from "@/lib/api/v1";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Custom index proposals (design artifacts with pricing coverage). Read-only;
// creation stays on POST /api/proposals (rate-limited + single-flighted).
export async function GET(request: Request) {
  const limited = await v1RateLimit(request);
  if (limited) return limited;
  try {
    const proposals = await listProposals();
    return v1Json({ proposals });
  } catch {
    return v1Error("database_unavailable");
  }
}
