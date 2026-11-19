import { NextRequest, NextResponse } from "next/server";
import { requireUser, hashPassword } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { one, run, tx, audit } from "@/lib/db";
import {
  listRoles, getRole, createRole, updateRole, deleteRole,
  listUsersWithRoles, setUserRoles, createUser, updateUser, resetUserPassword,
  reviewRegistration,
} from "@/lib/roles";

export const dynamic = "force-dynamic";

function requireAdmin(user: { roles: string[]; role: string }) {
  const roles = user.roles ?? [user.role];
  if (!roles.includes("boss") && !roles.includes("admin")) {
    throw new Error("无权限执行该操作（需要总经理或系统管理员）");
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    // 安全：GET 也必须校验管理员权限
    // 否则任何登录用户都能读取全部用户列表（含手机号、角色）
    requireAdmin(user);
    const t = req.nextUrl.searchParams.get("type");
    if (t === "roles") return NextResponse.json(listRoles());
    if (t === "users") return NextResponse.json(listUsersWithRoles());
    return NextResponse.json({ roles: listRoles(), users: listUsersWithRoles() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    requireAdmin(user);
    const body = await req.json();

    switch (body.action) {
      case "createRole": {
        const r = createRole({
          key: body.key, name: body.name, description: body.description,
          menus: body.menus ?? [], canSeeAmount: !!body.canSeeAmount,
        });
        return NextResponse.json({ ok: true, role: r });
      }
      case "updateRole": {
        updateRole(body.key, {
          name: body.name, description: body.description,
          menus: body.menus, canSeeAmount: body.canSeeAmount, active: body.active,
        });
        return NextResponse.json({ ok: true });
      }
      case "deleteRole": {
        deleteRole(body.key);
        return NextResponse.json({ ok: true });
      }
      case "createUser": {
        if (!body.password || String(body.password).length < 8) {
          return NextResponse.json({ error: "初始密码至少 8 位" }, { status: 400 });
        }
        const uid = createUser({
          name: body.name, username: body.username,
          dept: body.dept, phone: body.phone,
          roleKeys: body.roleKeys ?? [], primaryRole: body.primaryRole,
          password: body.password,
        });
        const { hash, salt } = hashPassword(String(body.password));
        resetUserPassword(uid, hash, salt);
        return NextResponse.json({ ok: true, id: uid });
      }
      case "updateUser": {
        updateUser(Number(body.id), {
          name: body.name, username: body.username,
          dept: body.dept, phone: body.phone, active: body.active,
        });
        return NextResponse.json({ ok: true });
      }
      case "setUserRoles": {
        setUserRoles(Number(body.id), body.roleKeys ?? [], body.primaryRole);
        return NextResponse.json({ ok: true });
      }
      case "reviewRegistration": {
        const r = reviewRegistration(Number(body.id), Boolean(body.approve), user.id);
        return NextResponse.json(r);
      }
      case "resetPassword": {
        if (!body.password || String(body.password).length < 8) {
          return NextResponse.json({ error: "新密码至少 8 位" }, { status: 400 });
        }
        const targetId = Number(body.id);
        const { hash, salt } = hashPassword(String(body.password));
        resetUserPassword(targetId, hash, salt);

        // 关键：管理员给自己改密码时，不该再标记「必须改密」
        // resetUserPassword 会把 must_change_pwd 设为 1，
        // 那是给「帮别人重置」用的（被重置的人需要自己再改一次）。
        // 但自己改自己的密码，是主动行为，改完就该正常使用。
        if (targetId === user.id) {
          run("UPDATE users SET must_change_pwd = 0 WHERE id = ?", [targetId]);
        }

        audit({
          userId: user.id, userName: user.name, action: "update",
          entityType: "users", entityId: targetId,
          summary: targetId === user.id
            ? "修改自己的登录密码"
            : `重置「${body.name ?? targetId}」的登录密码`,
        });

        return NextResponse.json({ ok: true });
      }

      // ---------- 停用 / 启用账号 ----------
      case "toggleUserActive": {
        const targetId = Number(body.id);
        if (targetId === user.id) {
          return NextResponse.json({ error: "不能停用自己的账号" }, { status: 400 });
        }
        const t = one<{ name: string; active: number }>(
          "SELECT name, active FROM users WHERE id = ?", [targetId]
        );
        if (!t) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

        const nextActive = t.active ? 0 : 1;
        // 停用最后一个管理员会把自己锁死，禁止
        if (nextActive === 0) {
          const admins = one<{ c: number }>(
            `SELECT COUNT(DISTINCT u.id) AS c FROM users u
             JOIN user_roles r ON r.user_id = u.id
             WHERE r.role_key IN ('boss','admin') AND u.active = 1 AND u.id != ?`,
            [targetId]
          )?.c ?? 0;
          if (admins === 0) {
            return NextResponse.json(
              { error: "这是最后一个启用中的管理员，停用后将无人能管理系统" },
              { status: 400 }
            );
          }
        }

        run("UPDATE users SET active = ? WHERE id = ?", [nextActive, targetId]);
        if (nextActive === 0) {
          // 停用即踢下线
          run("DELETE FROM sessions WHERE user_id = ?", [targetId]);
        }

        audit({
          userId: user.id, userName: user.name, action: "update",
          entityType: "users", entityId: targetId,
          summary: `${nextActive ? "启用" : "停用"}账号「${t.name}」`,
        });
        return NextResponse.json({ ok: true, active: nextActive });
      }

      // ---------- 删除用户 ----------
      case "deleteUser": {
        const targetId = Number(body.id);
        if (targetId === user.id) {
          return NextResponse.json({ error: "不能删除自己的账号" }, { status: 400 });
        }

        const t = one<{ name: string; username: string | null }>(
          "SELECT name, username FROM users WHERE id = ?", [targetId]
        );
        if (!t) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

        // 最后一个管理员不能删
        const admins = one<{ c: number }>(
          `SELECT COUNT(DISTINCT u.id) AS c FROM users u
           JOIN user_roles r ON r.user_id = u.id
           WHERE r.role_key IN ('boss','admin') AND u.id != ?`,
          [targetId]
        )?.c ?? 0;
        if (admins === 0) {
          return NextResponse.json(
            { error: "这是最后一个管理员，删除后将无人能管理系统" },
            { status: 400 }
          );
        }

        // 有业务归属的用户不允许直接删除（数据会失去责任人）
        const refs: string[] = [];
        const checks: [string, string, string][] = [
          ["projects", "owner_id", "负责的项目"],
          ["contracts", "owner_id", "负责的合同"],
          ["tickets", "owner_id", "处理中的工单"],
          ["bids", "owner_id", "负责的投标"],
        ];
        for (const [table, field, label] of checks) {
          try {
            const n = one<{ c: number }>(
              `SELECT COUNT(*) AS c FROM ${table}
               WHERE ${field} = ? AND deleted_at IS NULL`, [targetId]
            )?.c ?? 0;
            if (n > 0) refs.push(`${n} 个${label}`);
          } catch { /* 表或字段不存在则跳过 */ }
        }
        if (refs.length > 0) {
          return NextResponse.json({
            error: `该用户还有业务数据（${refs.join("、")}），不能删除。` +
                   `请先转移责任人，或改用「停用」保留其历史记录。`,
          }, { status: 400 });
        }

        // 审计日志要保留（谁做的什么操作），所以不物理删除用户，
        // 而是清除登录能力 + 标记删除，保证历史记录里的 user_id 仍可追溯
        const stamp = Date.now();
        tx(() => {
          run(
            `UPDATE users SET
               active = 0,
               totp_enabled = 0, totp_secret = NULL, totp_recovery = NULL,
               password_hash = NULL, password_salt = NULL,
               username = ?, name = ?
             WHERE id = ?`,
            [`__deleted_${targetId}_${stamp}`, `${t.name}（已删除）`, targetId]
          );
          run("DELETE FROM user_roles WHERE user_id = ?", [targetId]);
          run("DELETE FROM sessions WHERE user_id = ?", [targetId]);
        });

        audit({
          userId: user.id, userName: user.name, action: "delete",
          entityType: "users", entityId: targetId,
          summary: `删除账号「${t.name}」(${t.username ?? "-"})`,
        });

        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "未知操作" }, { status: 400 });
    }
  } catch (e) {
    return errorResponse(e);
  }
}
