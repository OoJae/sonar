// Next's boot hook. Deliberately a thin shim: Next bundles this file for every
// runtime including Edge, where fs and process.exit do not exist, and Turbopack
// analyses statically even through a `NEXT_RUNTIME` branch. Keeping the real
// work behind a dynamic import means the Edge bundle never contains it.
//
// See lib/admin/boot-check.ts for what this guards and why it has to exist.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootCheck } = await import("@/lib/admin/boot-check");
  bootCheck();
}
