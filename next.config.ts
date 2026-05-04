import type { NextConfig } from "next";

// Port 8080 is proxied by nginx on this VPS (see /etc/nginx/sites-enabled/sonar).
// allowedDevOrigins tells Turbopack dev that requests reaching it via the
// public IP are trusted, which silences the "origin not allowed" HMR warning.
const nextConfig: NextConfig = {
  allowedDevOrigins: ["http://43.153.109.3:8080", "http://localhost:3005"],
};

export default nextConfig;
