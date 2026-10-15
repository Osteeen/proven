import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Camera and location are needed for live proof photos; nothing else.
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Receipt photos are downscaled in the browser first; this leaves room for a 5 MB original.
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
    // Render's build box allows 2 CPUs but shows the host's cores; one worker per core ran out of 8 GB.
    cpus: 2,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
