import { NextRequest, NextResponse } from "next/server";
import { all, one, run, tx, audit } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";
import { updateRecord } from "@/lib/crud";
import { todayLocal } from "@/lib/time";

export const dynamic = "force-dynamic";

/** 新建出入库单 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.roles.includes("warehouse") && !user.roles.includes("pm")
        && !user.roles.includes("boss") && !user.roles.includes("admin")
        && !user.roles.includes("service")) {
      throw new AuthError("无权限登记出入库", 403);
    }

    const body = await req.json();
    const { direction, itemId, qty, warehouseId, projectId, purpose, remark, moveDate } = body;

    if (!["in", "out"].includes(direction)) throw new Error("direction 必须为 in 或 out");
    const n = Number(qty);
    if (!n || n <= 0) throw new Error("数量必须大于 0");

    const item = one<{ id: number; name: string; unit: string; track_sn: number }>(
      "SELECT id, name, unit, track_sn FROM items WHERE id = ?", [Number(itemId)]
    );
    if (!item) throw new Error("物料不存在");

    const wh = one<{ id: number; name: string }>(
      "SELECT id, name FROM warehouses WHERE id = ?", [Number(warehouseId)]
    );
    if (!wh) throw new Error("仓库不存在");

    let project: { id: number; code: string; name: string } | undefined;
    if (projectId) {
      project = one<{ id: number; code: string; name: string }>(
        "SELECT id, code, name FROM projects WHERE id = ?", [Number(projectId)]
      );
    }

    const result = tx((db) => {
      // 生成单号
      const prefix = direction === "in" ? "RK" : "CK";
      const year = new Date().getFullYear();
      const row = db.prepare("SELECT seq FROM code_sequences WHERE prefix=? AND year=?").get(prefix, year) as { seq: number } | undefined;
      const seq = (row?.seq ?? 0) + 1;
      if (row) db.prepare("UPDATE code_sequences SET seq=? WHERE prefix=? AND year=?").run(seq, prefix, year);
      else db.prepare("INSERT INTO code_sequences (prefix,year,seq) VALUES (?,?,?)").run(prefix, year, seq);
      const code = `${prefix}${year}-${String(seq).padStart(4, "0")}`;

      // 库存校验与更新
      const cur = db.prepare("SELECT qty FROM stock WHERE item_id=? AND warehouse_id=?").get(Number(itemId), Number(warehouseId)) as { qty: number } | undefined;

      if (direction === "out") {
        const have = cur?.qty ?? 0;
        if (have < n) {
          throw new Error(`库存不足：${item!.name} 当前 ${have} ${item!.unit}，需出库 ${n} ${item!.unit}`);
        }
      }

      const newQty = direction === "in" ? (cur?.qty ?? 0) + n : (cur?.qty ?? 0) - n;
      if (cur) {
        db.prepare("UPDATE stock SET qty=? WHERE item_id=? AND warehouse_id=?").run(newQty, Number(itemId), Number(warehouseId));
      } else {
        db.prepare("INSERT INTO stock (item_id, warehouse_id, qty) VALUES (?,?,?)").run(Number(itemId), Number(warehouseId), newQty);
      }

      const sourceText = direction === "in"
        ? (remark || "手工入库")
        : wh!.name;
      const targetText = direction === "in"
        ? wh!.name
        : (project ? `${project.code} 项目领用` : (purpose || "手工出库"));

      const info = db.prepare(
        `INSERT INTO stock_moves
         (code, direction, item_id, qty, warehouse_id, source_type, source_text, target_text,
          project_id, move_date, operator_id, status, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        code, direction, Number(itemId), n, Number(warehouseId),
        direction === "in" ? "manual" : (project ? "project" : "manual"),
        sourceText, targetText,
        project ? project.id : null,
        moveDate || todayLocal(),
        user.id,
        direction === "in" ? "已入库" : "已出库",
        remark || null
      );

      return { id: Number(info.lastInsertRowid), code, newQty };
    });

    audit({
      userId: user.id, userName: user.name, action: "create",
      entityType: "stock_move", entityId: result.id,
      summary: `${direction === "in" ? "入库" : "出库"} ${item.name} ${n} ${item.unit}（单号 ${result.code}），库存余 ${result.newQty}`,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 物料 / 仓库下拉数据 */
export async function GET() {
  try {
    await requireUser();
    const items = all<{ id: number; sku: string; name: string; unit: string; spec: string | null }>(
      "SELECT id, sku, name, unit, spec FROM items WHERE active = 1 ORDER BY id"
    );
    const warehouses = all<{ id: number; name: string }>(
      "SELECT id, name FROM warehouses ORDER BY id"
    );
    const projects = all<{ id: number; code: string; name: string }>(
      "SELECT id, code, name FROM projects WHERE stage IN ('实施','验收') ORDER BY id DESC"
    );
    return NextResponse.json({ items, warehouses, projects });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 修改出入库单（不改变库存数量，仅改备注/日期/用途） */
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    const b = await req.json();
    const { id, moveDate, remark, projectId } = b;
    if (!id) throw new Error("缺少单据 id");

    return NextResponse.json(updateRecord({
      table: "stock_moves",
      id: Number(id),
      user,
      label: "出入库单",
      fields: {
        move_date: moveDate !== undefined ? { value: moveDate } : undefined,
        remark: remark !== undefined ? { value: remark } : undefined,
        project_id: projectId !== undefined
          ? { value: projectId === "" || projectId === null ? null : Number(projectId), type: "number" }
          : undefined,
      } as never,
    }));
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除出入库单：回滚库存（关键） */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) throw new Error("缺少单据 id");

    if (!["boss", "admin", "warehouse"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限删除出入库单", 403);
    }

    const m = one<{
      code: string; direction: string; item_id: number; qty: number;
      warehouse_id: number; deleted_at: string | null;
    }>("SELECT code, direction, item_id, qty, warehouse_id, deleted_at FROM stock_moves WHERE id = ?", [id]);

    if (!m) throw new Error("单据不存在");
    if (m.deleted_at) throw new Error("该单据已删除");

    tx((db) => {
      // 回滚库存：入库单删除要扣减，出库单删除要加回
      const delta = m.direction === "in" ? -m.qty : m.qty;
      const cur = db.prepare("SELECT qty FROM stock WHERE item_id=? AND warehouse_id=?")
        .get(m.item_id, m.warehouse_id) as { qty: number } | undefined;

      if (cur) {
        const newQty = cur.qty + delta;
        if (newQty < 0) {
          throw new Error(
            "无法删除：回滚后库存将为负数（原入库物料可能已被领用），当前库存 " + cur.qty
          );
        }
        db.prepare("UPDATE stock SET qty=? WHERE item_id=? AND warehouse_id=?")
          .run(newQty, m.item_id, m.warehouse_id);
      }

      db.prepare("UPDATE stock_moves SET deleted_at = datetime('now','localtime'), deleted_by = ? WHERE id = ?")
        .run(user.id, id);
    });

    audit({
      userId: user.id, userName: user.name, action: "delete",
      entityType: "stock_moves", entityId: id,
      summary: "删除出入库单 " + m.code + "，库存已回滚 " + (m.direction === "in" ? "-" : "+") + m.qty,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
