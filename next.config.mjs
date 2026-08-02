/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  images: { unoptimized: true },
  experimental: {
    proxyClientMaxBodySize: process.env.IMAGEROUTER_MAX_BODY_SIZE || "32mb",
  },
};

export default nextConfig;
