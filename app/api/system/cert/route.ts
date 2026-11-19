import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { getCertInfo, getParams } from "@/lib/sysinfo";

export const dynamic = "force-dynamic";

/** 读取 SSL 证书状态（含私钥匹配、SAN、密钥强度） */
export async function GET() {
  try {
    const user = await requireUser();
    const roles = user.roles ?? [user.role];
    if (!roles.includes("boss") && !roles.includes("admin")) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const p = getParams();
    const certPath = p.ssl_cert_path || "";
    const keyPath = p.ssl_key_path || "";

    // 未配置时尝试常见默认路径（应用容器内 certs 挂在 /app/certs）
    let info = getCertInfo(certPath, keyPath || undefined);

    // 未配置路径时，按「证书与私钥同目录」的惯例自动配对
    if (!certPath) {
      const pairs: { cert: string; key: string }[] = [
        { cert: "/app/certs/server.crt", key: "/app/certs/server.key" },
        { cert: "/app/certs/fullchain.pem", key: "/app/certs/privkey.pem" },
        { cert: "/app/certs/cert.pem", key: "/app/certs/key.pem" },
      ];
      for (const pair of pairs) {
        const t = getCertInfo(pair.cert, pair.key);
        if (t.found) { info = t; break; }
      }
    }

    return NextResponse.json({
      cert: info,
      warnDays: Number(p.ssl_expire_warn_days ?? 30),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
