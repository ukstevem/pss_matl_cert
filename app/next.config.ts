import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  basePath: "/matl-cert",
  trailingSlash: true,
  output: "standalone",
  typescript: { ignoreBuildErrors: true },
  transpilePackages: ["@platform/supabase", "@platform/auth", "@platform/ui"],
};

export default nextConfig;
