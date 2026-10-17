import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Hide the Next.js dev compile indicator (bottom-left) so screenshots/GIFs stay clean.
  devIndicators: false,
};

export default nextConfig;
