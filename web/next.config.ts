import type { NextConfig } from "next";

const aggregatorUrl =
  process.env.NEXT_PUBLIC_WALRUS_AGGREGATOR_URL ??
  "https://aggregator.walrus-testnet.walrus.space";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [
      {
        source: "/api/walrus/:path*",
        destination: `${aggregatorUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
