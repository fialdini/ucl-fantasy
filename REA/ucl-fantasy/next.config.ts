import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@electric-sql/pglite"],
  // Amigos acessando pela rede local ou VPN (ex.: Radmin 26.x.x.x) durante o `npm run dev`.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "26.*.*.*", "*.trycloudflare.com"],
  // As migrações SQL rodam na primeira conexão; precisam ir junto no bundle serverless.
  outputFileTracingIncludes: { "/**": ["./drizzle/**/*"] },
};

export default nextConfig;
