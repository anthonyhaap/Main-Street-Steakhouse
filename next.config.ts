import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The old League Home dashboard was retired: everything it showed lives on
  // the home screen, /standings, /matchups, /draft, /ledger and /admin.
  async redirects() {
    return [{ source: "/league", destination: "/", permanent: false }];
  },
};

export default nextConfig;
