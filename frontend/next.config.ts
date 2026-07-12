import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundles only the files the server actually needs, so the Docker image does
  // not carry node_modules or the source tree.
  output: "standalone",
  /* config options here */
};

export default nextConfig;
