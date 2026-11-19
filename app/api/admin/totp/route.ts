import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { one, run, audit } from "@/lib/db";
import {
  generateSecret, verifyTotp, buildOtpAuthUri,
  generateRecoveryCodes, packRecoveryCodes,
} from "@/lib/totp";

export const dynamic = "force-dynamic";

function requireAdmin(user: { roles: string[]; role: string }) {
  const roles = user.roles ?? [user.role];
  if (!roles.includes("boss") && !roles.includes("admin")) {
    throw new Error("无权限管理令牌认证（需要总经理或系统管理员）");
  }
}

/** 查询某用户的令牌状态 */
export async function GET(req: NextRequest) {
  try {
    const me = await requireUser();
    const id = Number(req.nextUrl.searchParams.get("userId") ?? me.id);

    // 只能查自己，或管理员查别人
    const roles = me.roles ?? [me.role];
    const isAdmin = roles.includes("boss") || roles.includes("admin");
    if (id !== me.id && !isAdmin) {
      return NextResponse.json({ error: "无权限查看他人令牌状态" }, { status: 403 });
    }

    const u = one<{
      id: number; name: string; username: string | null;
      totp_enabled: number; totp_bound_at: string | null;
      totp_last_used: string | null; totp_recovery: string | null;
    }>(
      `SELECT id, name, username, totp_enabled, totp_bound_at,
              totp_last_used, totp_recovery
       FROM users WHERE id = ?`,
      [id]
    );
    if (!u) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

    // 剩余恢复码数量
    let recoveryLeft = 0;
    try {
      const list = JSON.parse(u.totp_recovery ?? "[]") as { used: boolean }[];
      recoveryLeft = list.filter((c) => !c.used).length;
    } catch { recoveryLeft = 0; }

    return NextResponse.json({
      userId: u.id,
      name: u.name,
      username: u.username,
      enabled: u.totp_enabled === 1,
      boundAt: u.totp_bound_at,
      lastUsed: u.totp_last_used,
      recoveryLeft,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const me = await requireUser();
    const body = await req.json();
    const action = String(body.action ?? "");

    switch (action) {
      // ---------- 生成密钥（尚未启用，需用户验证一次动态码确认） ----------
      case "setup": {
        const targetId = Number(body.userId ?? me.id);
        const roles = me.roles ?? [me.role];
        const isAdmin = roles.includes("boss") || roles.includes("admin");
        if (targetId !== me.id && !isAdmin) {
          return NextResponse.json({ error: "无权限为他人配置令牌" }, { status: 403 });
        }

        const u = one<{ id: number; name: string; username: string | null }>(
          "SELECT id, name, username FROM users WHERE id = ?", [targetId]
        );
        if (!u) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

        const secret = generateSecret();
        // 先存密钥但不启用（totp_enabled 保持 0）
        run(
          "UPDATE users SET totp_secret = ?, totp_enabled = 0, totp_bound_at = NULL WHERE id = ?",
          [secret, targetId]
        );

        const account = u.username || u.name;
        return NextResponse.json({
          ok: true,
          secret,
          uri: buildOtpAuthUri({ secret, account }),
          account,
        });
      }

      // ---------- 确认绑定（验证一次动态码后启用） ----------
      case "confirm": {
        const targetId = Number(body.userId ?? me.id);
        const roles = me.roles ?? [me.role];
        const isAdmin = roles.includes("boss") || roles.includes("admin");
        if (targetId !== me.id && !isAdmin) {
          return NextResponse.json({ error: "无权限" }, { status: 403 });
        }

        const u = one<{ id: number; name: string; totp_secret: string | null }>(
          "SELECT id, name, totp_secret FROM users WHERE id = ?", [targetId]
        );
        if (!u) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
        if (!u.totp_secret) {
          return NextResponse.json({ error: "请先生成密钥" }, { status: 400 });
        }

        if (!verifyTotp(u.totp_secret, String(body.code ?? ""))) {
          return NextResponse.json({ error: "动态码不正确，请检查后重试" }, { status: 400 });
        }

        const codes = generateRecoveryCodes(8);
        run(
          `UPDATE users SET totp_enabled = 1, totp_recovery = ?,
             totp_bound_at = datetime('now','localtime') WHERE id = ?`,
          [packRecoveryCodes(codes), targetId]
        );

        audit({
          userId: me.id, userName: me.name, action: "update",
          entityType: "users", entityId: targetId,
          summary: `为「${u.name}」启用令牌认证`,
        });

        return NextResponse.json({ ok: true, recoveryCodes: codes });
      }

      // ---------- 关闭令牌认证（需要验证当前动态码或管理员权限） ----------
      case "disable": {
        const targetId = Number(body.userId ?? me.id);
        const roles = me.roles ?? [me.role];
        const isAdmin = roles.includes("boss") || roles.includes("admin");

        const u = one<{ id: number; name: string; totp_secret: string | null; totp_enabled: number }>(
          "SELECT id, name, totp_secret, totp_enabled FROM users WHERE id = ?", [targetId]
        );
        if (!u) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

        // 自己关自己，必须验证动态码；管理员关别人可直接操作
        if (targetId === me.id && !isAdmin) {
          if (!verifyTotp(u.totp_secret ?? "", String(body.code ?? ""))) {
            return NextResponse.json({ error: "动态码不正确" }, { status: 400 });
          }
        } else if (targetId === me.id && isAdmin) {
          // 管理员关自己，也要求验证，防止误操作
          if (u.totp_enabled === 1 && !verifyTotp(u.totp_secret ?? "", String(body.code ?? ""))) {
            return NextResponse.json({ error: "关闭自己的令牌认证需验证动态码" }, { status: 400 });
          }
        }

        run(
          `UPDATE users SET totp_enabled = 0, totp_secret = NULL,
             totp_recovery = NULL, totp_bound_at = NULL WHERE id = ?`,
          [targetId]
        );

        audit({
          userId: me.id, userName: me.name, action: "update",
          entityType: "users", entityId: targetId,
          summary: `为「${u.name}」关闭令牌认证`,
        });

        return NextResponse.json({ ok: true });
      }

      // ---------- 重置恢复码 ----------
      case "resetRecovery": {
        const targetId = Number(body.userId ?? me.id);
        requireAdmin(me);

        const u = one<{ id: number; name: string; totp_enabled: number }>(
          "SELECT id, name, totp_enabled FROM users WHERE id = ?", [targetId]
        );
        if (!u) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
        if (u.totp_enabled !== 1) {
          return NextResponse.json({ error: "该用户未启用令牌认证" }, { status: 400 });
        }

        const codes = generateRecoveryCodes(8);
        run("UPDATE users SET totp_recovery = ? WHERE id = ?", [packRecoveryCodes(codes), targetId]);

        audit({
          userId: me.id, userName: me.name, action: "update",
          entityType: "users", entityId: targetId,
          summary: `重置「${u.name}」的恢复码`,
        });

        return NextResponse.json({ ok: true, recoveryCodes: codes });
      }

      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
