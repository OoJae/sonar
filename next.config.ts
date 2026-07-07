import type { NextConfig } from "next";

// nginx on this VPS terminates TLS at https://sonar.my.id and proxies to
// localhost:3005 (see /etc/nginx/sites-enabled/sonar). allowedDevOrigins
// tells Turbopack dev that requests reaching it via these hosts are trusted,
// silencing the "origin not allowed" HMR warning.
const nextConfig: NextConfig = {
  // Do not advertise the framework/version in an X-Powered-By response header.
  poweredByHeader: false,
  allowedDevOrigins: [
    "https://sonar.my.id",
    "http://localhost:3005",
  ],
};

export default nextConfig;
