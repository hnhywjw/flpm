import { NextRequest, NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/auth";
import { parseCsv } from "@/lib/csv";
import { one, run, nextCode, audit, tx } from "@/lib/db";
import { NODE_CHAIN, wanToFen } from "@/lib/domain";
import { errorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/** 下载导入模板 */
export async function GET() {
  const headers = ["项目名称", "客户名称", "项目类型", "模式(直接中标/代中标)", "负责人", "预算(万元)", "开始日期", "计划完成"];
  const sample = [
    ["示例：某某单位机房改造", "某某单位", "工程实施", "直接中标", "张立群", "120.5", "2026-11-01", "2027-03-31"],
  ];
  const BOM = "\uFEFF";
  const csv = BOM + [headers.join(","), ...sample.map((r) => r.join(","))].join("\r\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("项目导入模板.csv")}`,
    },
  });
}

/** 批量导入项目 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["boss", "admin", "sales", "pm"].includes(user.role)) {
      throw new AuthError("无权限导入项目", 403);
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "未选择文件" }, { status: 400 });
    }
    const text = await file.text();
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return NextResponse.json({ error: "文件为空或缺少数据行" }, { status: 400 });
    }

    const header = rows[0].map((h) => h.trim());
    const idx = (name: string) => header.findIndex((h) => h.includes(name));

    const iName = idx("项目名称");
    const iCust = idx("客户");
    const iType = idx("项目类型");
    const iMode = idx("模式");
    const iOwner = idx("负责人");
    const iBudget = idx("预算");
    const iStart = idx("开始");
    const iDue = idx("计划完成");

    if (iName < 0) {
      return NextResponse.json({ error: "缺少必需列「项目名称」" }, { status: 400 });
    }

    const results: { row: number; ok: boolean; msg: string; code?: string }[] = [];

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const name = (row[iName] ?? "").trim();
      if (!name) continue;

      try {
        const custName = iCust >= 0 ? (row[iCust] ?? "").trim() : "";
        let custId: number | null = null;
        if (custName) {
          const c = one<{ id: number }>("SELECT id FROM customers WHERE name = ?", [custName]);
          if (c) custId = c.id;
          else {
            const ir = run("INSERT INTO customers (name) VALUES (?)", [custName]);
            custId = Number(ir.lastInsertRowid);
          }
        }

        const modeRaw = iMode >= 0 ? (row[iMode] ?? "").trim() : "";
        const mode = modeRaw.includes("代") ? "agent" : "direct";

        let ownerId: number | null = user.id;
        if (iOwner >= 0) {
          const ownerName = (row[iOwner] ?? "").trim();
          if (ownerName) {
            const u = one<{ id: number }>("SELECT id FROM users WHERE name = ?", [ownerName]);
            if (u) ownerId = u.id;
          }
        }

        const budget = iBudget >= 0 ? Number((row[iBudget] ?? "").replace(/[,\s]/g, "")) : 0;
        const budgetCents = budget > 0 ? wanToFen(budget) : null;

        const code = nextCode("P");
        const pid = tx((db) => {
          const ir = db.prepare(
            `INSERT INTO projects (code, name, customer_id, project_type, mode, stage, status, owner_id, budget_cents, start_date, plan_due)
             VALUES (?, ?, ?, ?, ?, '投标', '进行中', ?, ?, ?, ?)`
          ).run(
            code, name, custId,
            iType >= 0 ? (row[iType] ?? "").trim() || null : null,
            mode, ownerId, budgetCents,
            iStart >= 0 ? (row[iStart] ?? "").trim() || null : null,
            iDue >= 0 ? (row[iDue] ?? "").trim() || null : null
          );
          const newId = Number(ir.lastInsertRowid);
          NODE_CHAIN.forEach((n, i) => {
            db.prepare(
              `INSERT INTO project_nodes (project_id, node_key, seq, is_parallel, status, require_files)
               VALUES (?, ?, ?, ?, ?, ?)`
            ).run(newId, n.key, n.seq, n.isParallel ? 1 : 0, i === 0 ? "cur" : "next",
                  n.key === "验收" ? JSON.stringify(["安装配置文档", "到货签收单", "验收报告", "项目资料"]) : null);
          });
          return newId;
        });

        results.push({ row: r + 1, ok: true, msg: "导入成功", code });
      } catch (e) {
        results.push({ row: r + 1, ok: false, msg: (e as Error).message });
      }
    }

    const okCount = results.filter((x) => x.ok).length;
    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "project", entityId: null,
      summary: `批量导入项目：成功 ${okCount} 个，失败 ${results.length - okCount} 个`,
    });

    return NextResponse.json({ ok: true, total: results.length, success: okCount, results });
  } catch (e) {
    return errorResponse(e);
  }
}
