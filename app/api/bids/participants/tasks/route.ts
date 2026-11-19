import { NextRequest, NextResponse } from "next/server";
import { all, one, run, audit } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { canAccessEntity } from "@/lib/attachment-acl";

export const dynamic = "force-dynamic";

/**
 * 参与方的投标任务进度
 *
 * GET  ?participantId=5   取这一家的任务清单（含进度百分比）
 * PUT  提交整批任务（前端一次改多项，整批覆盖比逐项 PATCH 更省事且一致）
 *
 * 权限：复用附件的 ACL —— 参与方能看，就能看它的任务进度。
 */

interface TaskRow {
  id: number;
  participant_id: number;
  title: string;
  progress: number;
  owner: string | null;
  due_date: string | null;
  note: string | null;
  seq: number;
}

/** 汇总进度：按项取平均，取整 */
function overallProgress(rows: { progress: number }[]): number {
  if (rows.length === 0) return 0;
  const sum = rows.reduce((s, r) => s + (Number(r.progress) || 0), 0);
  return Math.round(sum / rows.length);
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const participantId = Number(req.nextUrl.searchParams.get("participantId"));
    if (!participantId) {
      return NextResponse.json({ error: "缺少 participantId" }, { status: 400 });
    }

    // 参与方 → 所属投标 → 项目权限
    if (!canAccessEntity(user, "bid_participant", participantId)) {
      return NextResponse.json({ error: "无权查看该参与方" }, { status: 403 });
    }

    const exists = one<{ id: number }>(
      "SELECT id FROM bid_participants WHERE id = ?", [participantId]
    );
    if (!exists) return NextResponse.json({ error: "参与方不存在" }, { status: 404 });

    const rows = all<TaskRow>(
      "SELECT * FROM bid_participant_tasks WHERE participant_id = ? ORDER BY seq, id",
      [participantId]
    );

    // 项目级任务（原来单独渲染在页面底部的「投标任务分解」）
    // 迁移到这里：并入任务进度弹窗，不再占展开区一大块。
    //
    // 只对本方参与方展示 —— 陪标公司的任务分解是我方的内部计划，
    // 挂在陪标那家的弹窗里没有业务意义，还会误导。
    const part = one<{ is_self: number; bid_id: number }>(
      "SELECT is_self, bid_id FROM bid_participants WHERE id = ?", [participantId]
    );
    const isSelf = part?.is_self === 1;
    const bidTasks = isSelf && part
      ? all<{
          id: number; title: string; status: string | null;
          owner_name: string | null; due_date: string | null;
        }>(
          `SELECT t.id, t.title, t.status, u.name AS owner_name, t.due_date
           FROM bid_tasks t LEFT JOIN users u ON u.id = t.owner_id
           WHERE t.bid_id = ? ORDER BY t.seq, t.id`,
          [part.bid_id]
        )
      : [];

    return NextResponse.json({
      tasks: rows,
      overall: overallProgress(rows),
      isSelf,
      bidTasks,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * 整批保存
 *
 * body: { participantId, tasks: [{ id?, title, progress, owner?, dueDate?, note? }] }
 *
 * 设计：以「提交的清单」为准
 *   · 带 id 的更新
 *   · 不带 id 的新增
 *   · 提交里没有的旧任务 → 删除
 * 这样前端可以自由增删任务项，一次保存。
 */
export async function PUT(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["sales", "boss", "admin", "pm"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限维护投标任务进度", 403);
    }

    const body = await req.json();
    const participantId = Number(body.participantId);
    const incoming = Array.isArray(body.tasks) ? body.tasks : [];

    if (!participantId) throw new Error("缺少 participantId");
    if (!canAccessEntity(user, "bid_participant", participantId)) {
      throw new AuthError("无权修改该参与方", 403);
    }

    const p = one<{ id: number; company_name: string; bid_id: number }>(
      "SELECT id, company_name, bid_id FROM bid_participants WHERE id = ?", [participantId]
    );
    if (!p) throw new Error("参与方不存在");

    // 校验
    for (const t of incoming) {
      if (!String(t.title ?? "").trim()) throw new Error("任务名称不能为空");
      const pr = Number(t.progress);
      if (!Number.isFinite(pr) || pr < 0 || pr > 100) {
        throw new Error(`任务「${t.title}」的进度必须在 0-100 之间`);
      }
    }

    const before = all<TaskRow>(
      "SELECT * FROM bid_participant_tasks WHERE participant_id = ? ORDER BY seq",
      [participantId]
    );
    const beforeOverall = overallProgress(before);

    // 逐条 upsert
    const keepIds: number[] = [];
    incoming.forEach((t: Record<string, unknown>, i: number) => {
      const id = Number(t.id) || 0;
      const title = String(t.title).trim();
      const progress = Math.round(Number(t.progress));
      const owner = t.owner ? String(t.owner).trim() || null : null;
      const dueDate = t.dueDate ? String(t.dueDate) || null : null;
      const note = t.note ? String(t.note).trim() || null : null;

      if (id > 0) {
        const own = one<{ participant_id: number }>(
          "SELECT participant_id FROM bid_participant_tasks WHERE id = ?", [id]
        );
        // 防止把别的参与方的任务 id 塞进来改掉
        if (!own || own.participant_id !== participantId) {
          throw new Error("任务不属于该参与方");
        }
        run(
          `UPDATE bid_participant_tasks SET
             title = ?, progress = ?, owner = ?, due_date = ?, note = ?, seq = ?,
             updated_at = datetime('now','localtime')
           WHERE id = ?`,
          [title, progress, owner, dueDate, note, i + 1, id]
        );
        keepIds.push(id);
      } else {
        const info = run(
          `INSERT INTO bid_participant_tasks
             (participant_id, title, progress, owner, due_date, note, seq, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))`,
          [participantId, title, progress, owner, dueDate, note, i + 1]
        );
        keepIds.push(Number(info.lastInsertRowid));
      }
    });

    // 删掉提交里没有的
    for (const b of before) {
      if (!keepIds.includes(b.id)) {
        run("DELETE FROM bid_participant_tasks WHERE id = ?", [b.id]);
      }
    }

    const after = all<TaskRow>(
      "SELECT * FROM bid_participant_tasks WHERE participant_id = ? ORDER BY seq, id",
      [participantId]
    );
    const afterOverall = overallProgress(after);

    if (afterOverall !== beforeOverall) {
      audit({
        userId: user.id, userName: user.name, action: "update",
        entityType: "bid_participant", entityId: participantId,
        field: "task_progress",
        oldValue: String(beforeOverall), newValue: String(afterOverall),
        summary: `${p.company_name} 的投标任务进度 ${beforeOverall}% → ${afterOverall}%`,
      });
    }

    return NextResponse.json({ ok: true, tasks: after, overall: afterOverall });
  } catch (e) {
    return errorResponse(e);
  }
}
