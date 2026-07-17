// Who may arm real money.
//
// Server-only. SONAR_ADMIN_ADDRESSES carries no NEXT_PUBLIC_ prefix, so it cannot
// reach the client bundle, and there is deliberately no endpoint that returns the
// list or answers "is X an admin". A visitor can only ever learn whether THEY are
// an admin, and only by producing a valid signature from the address being asked
// about, so the list cannot be enumerated by a stranger.
//
// Unset means the toggle is closed: with no allowlist, isAdmin() is false for
// everyone and POST /api/admin/mode can only 403. That is the correct default for
// a public site, and it means forgetting to configure this fails safe.

import { getAddress } from "viem";
import { env } from "@/lib/utils/env";

/** Checksummed admin addresses. Malformed entries are dropped, not thrown on:
 *  one typo in the env var must not take the whole site down at boot. */
export function adminAddresses(): string[] {
  const raw = env().SONAR_ADMIN_ADDRESSES;
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return getAddress(s);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export function isAdmin(address: string): boolean {
  const list = adminAddresses();
  if (list.length === 0) return false;
  try {
    return list.includes(getAddress(address));
  } catch {
    return false;
  }
}

/** True when an allowlist is configured at all. Lets the UI say "operator only"
 *  rather than "you are not authorized" on a deployment with the toggle closed. */
export function adminToggleConfigured(): boolean {
  return adminAddresses().length > 0;
}
