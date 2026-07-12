import { execSync } from "node:child_process";
import type { NextConfig } from "next";

// nginx on this VPS terminates TLS at https://sonar.my.id and proxies to
// localhost:3005 (see /etc/nginx/sites-enabled/sonar). allowedDevOrigins
// tells Turbopack dev that requests reaching it via these hosts are trusted,
// silencing the "origin not allowed" HMR warning.

// Version stamp: resolved at BUILD time and inlined into the bundle, so the
// footer and /api/v1/status always describe the built artifact (reading .git
// at runtime would lie after a pull without a rebuild).
function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return process.env.SONAR_GIT_SHA ?? "dev";
  }
}

const nextConfig: NextConfig = {
  // Do not advertise the framework/version in an X-Powered-By response header.
  poweredByHeader: false,
  env: {
    SONAR_GIT_SHA: gitSha(),
  },
  allowedDevOrigins: [
    "https://sonar.my.id",
    "http://localhost:3005",
  ],
};

export default nextConfig;
