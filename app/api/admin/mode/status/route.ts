// GET /api/admin/mode/status - what mode is THIS process actually running?
//
// Deliberately separate from /api/v1/status, which cannot do this job: it is
// served with `Cache-Control: public, max-age=15`, so a client polling it across
// a restart can read a cached body and conclude the flip failed when it worked,
// or that it worked when the process has not come back yet.
//
// bootId is the point. It is minted once per process, so a CHANGED bootId is the
// only honest proof that the restart actually happened. Mode alone cannot tell
// "the new process is up and armed" apart from "I am reading a stale response
// from the old one". The client confirms on bootId change AND mode match.
//
// Reports env(), never the drop-in file. The file is intent; env() is what this
// process is actually doing. They differ exactly when a drop-in has been written
// but the restart has not happened yet, which is precisely when a wrong answer
// would matter most.
//
// Public and unauthenticated: the mode is already on every page in the header
// badge and in /api/v1/status, so this leaks nothing new. It is cheap (no DB, no
// network) and uncached by design.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/utils/env";
import { dropinExists } from "@/lib/admin/dropin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Module scope: one value for the lifetime of this process.
const BOOT_ID = randomUUID();

export async function GET() {
  return NextResponse.json(
    {
      mode: env().SONAR_EXECUTION_MODE,
      bootId: BOOT_ID,
      // True when this process booted with a drop-in present. If this is true
      // while mode is not live-mainnet, the drop-in was written but the process
      // has not restarted, or the boot guard self-healed it away.
      armedByDropin: dropinExists(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
