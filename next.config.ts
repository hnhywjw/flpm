import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 是原生模块，不参与打包
  serverExternalPackages: ["better-sqlite3"],

  // 升级包上传最大 500MB；Next.js 15 的 body 限制配置
  experimental: {
    serverActions: {
      bodySizeLimit: "500mb",
    },
  },

  // 部署在 Nginx 反向代理之后，信任代理头
  // 用于正确识别 https、客户端 IP
  poweredByHeader: false,

  // 安全响应头
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
