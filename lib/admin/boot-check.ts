// The boot guard proper. Called once per server process from instrumentation.ts,
// which keeps this module out of the Edge bundle (process.exit and fs do not
// exist there, and Turbopack analyses statically even through a runtime branch).
//
// Why a boot guard had to be written: until now Sonar had a FIRST-REQUEST guard
// wearing a boot guard's clothes. env() is only ever called inside function
// bodies, so `next start` binds :3005 and looks perfectly healthy no matter how
// invalid the environment is. The first request that touches env() throws, every
// route 500s, and the process stays alive. systemd sees Type=simple with a live
// main PID and concludes all is well, so Restart=always NEVER FIRES. An invalid
// env was a silent, permanent outage that only SSH could end.
//
// Survivable while the mode could only change over SSH. Not survivable once
// POST /api/admin/mode can write a systemd env drop-in. Hence:
//
//   - The route PREFLIGHTS with validateEnvCandidate before writing. That is the
//     real defense; nothing invalid should reach the disk.
//   - This is the backstop for when it does anyway. If env() fails and a drop-in
//     exists, delete it and exit non-zero. systemd restarts in RestartSec=5,
//     finds no drop-in, falls back to .env.local (testnet) and boots clean and
//     DISARMED. The delete is what makes this terminate: exiting alone would
//     crash-loop forever on the same bad file.

import { env } from "@/lib/utils/env";
import { dropinExists, removeDropin, DROPIN_PATH } from "@/lib/admin/dropin";

export function bootCheck(): void {
  try {
    const e = env();
    if (e.SONAR_EXECUTION_MODE === "live-mainnet") {
      // Loud on purpose. A drop-in outlives the request that wrote it, so the
      // dangerous case is not an operator flipping and watching: it is an
      // unrelated restart (deploy, OOM, reboot) silently arming mainnet with
      // nobody looking. This line makes that impossible to miss in the journal.
      console.warn(
        `[boot] ARMED: live-mainnet. Real funds are in scope. Drop-in: ${
          dropinExists() ? DROPIN_PATH : "none (mode came from .env.local)"
        }. Disarm with: rm ${DROPIN_PATH} && systemctl restart sonar`,
      );
    } else {
      console.log(`[boot] mode=${e.SONAR_EXECUTION_MODE} (not armed)`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[boot] invalid environment:\n${msg}`);

    if (dropinExists()) {
      console.error(
        `[boot] a mode drop-in is present and the env it produces will not boot. ` +
          `Removing ${DROPIN_PATH} and exiting so systemd restarts onto the ` +
          `.env.local baseline (testnet, disarmed).`,
      );
      try {
        removeDropin();
      } catch (rmErr) {
        // If the drop-in cannot be removed, exiting WOULD crash-loop. Staying up
        // to serve 500s is the lesser evil: visible, and fixable over SSH.
        console.error(
          `[boot] could not remove the drop-in: ${
            rmErr instanceof Error ? rmErr.message : String(rmErr)
          }. Staying up rather than crash-looping. Fix by hand: rm ${DROPIN_PATH}`,
        );
        return;
      }
      process.exit(1);
    }

    // No drop-in to blame: .env.local itself is broken and there is nothing to
    // undo. Exiting would crash-loop with no way out, so rethrow and let the
    // 500s be the signal. That is the pre-existing behaviour, no worse.
    throw err;
  }
}
