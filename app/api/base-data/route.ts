import { NextRequest, NextResponse } from "next/server";
import { all, one, run, audit } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { errorResponse } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/** 支持维护的基础数据 */
const TABLES: Record<string, {
  label: string;
  fields: string[];
  searchField: string;
}> = {
  customers: { label: "客户", fields: ["name", "short_name", "contact", "phone", "address"], searchField: "name" },
  items: { label: "物料", fields: ["sku", "name", "spec", "unit", "safe_stock"], searchField: "name" },
  warehouses: { label: "仓库", fields: ["name", "location", "manager"], searchField: "name" },
};

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const sp = req.nextUrl.searchParams;
    const type = sp.get("type") ?? "";
    const kw = (sp.get("kw") ?? "").trim();

    if (type && !TABLES[type]) {
      return NextResponse.json({ error: "不支持的类型" }, { status: 400 });
    }

    const out: Record<string, unknown[]> = {};
    const targets = type ? [type] : Object.keys(TABLES);

    for (const t of targets) {
      const meta = TABLES[t];
      let sql = `SELECT * FROM ${t}`;
      const params: unknown[] = [];
      if (kw) {
        sql += ` WHERE ${meta.searchField} LIKE ?`;
        params.push(`%${kw}%`);
      }
      sql += " ORDER BY id DESC LIMIT 200";
      try {
        out[t] = all(sql, params);
      } catch {
        out[t] = [];
      }
    }

    return NextResponse.json({ tables: TABLES, data: out });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!["boss", "admin"].some((r) => user.roles.includes(r))) {
      throw new AuthError("无权限维护基础数据（需要总经理或系统管理员）", 403);
    }

    const b = await req.json();
    const { type, action } = b;
    if (!type || !TABLES[type]) {
      return NextResponse.json({ error: "不支持的类型" }, { status: 400 });
    }
    const meta = TABLES[type];

    if (action === "create") {
      const values = b.values ?? {};
      const cols: string[] = [];
      const ph: string[] = [];
      const params: unknown[] = [];

      for (const f of meta.fields) {
        if (values[f] === undefined || values[f] === "") continue;
        cols.push(f);
        ph.push("?");
        params.push(f === "safe_stock" ? Number(values[f]) : values[f]);
      }

      if (cols.length === 0) return NextResponse.json({ error: "没有可填字段" }, { status: 400 });

      // 唯一性检查（客户名、物料 SKU、仓库名）
      if (type === "customers" && values.name) {
        const d = one<{ id: number }>("SELECT id FROM customers WHERE name = ?", [values.name]);
        if (d) return NextResponse.json({ error: "该客户已存在" }, { status: 400 });
      }
      if (type === "items" && values.sku) {
        const d = one<{ id: number }>("SELECT id FROM items WHERE sku = ?", [values.sku]);
        if (d) return NextResponse.json({ error: "该物料编码已存在" }, { status: 400 });
      }

      const info = run(
        `INSERT INTO ${type} (${cols.join(",")}) VALUES (${ph.join(",")})`,
        params
      );

      audit({
        userId: user.id, userName: user.name, action: "create",
        entityType: type, entityId: Number(info.lastInsertRowid),
        summary: `新增${meta.label}：${values[meta.searchField] ?? ""}`,
      });

      return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid) });
    }

    if (action === "update") {
      const { id, values } = b;
      if (!id) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

      const sets: string[] = [];
      const params: unknown[] = [];
      for (const f of meta.fields) {
        if (values[f] === undefined) continue;
        sets.push(`${f} = ?`);
        params.push(f === "safe_stock" ? Number(values[f]) : (values[f] || null));
      }
      if (sets.length === 0) return NextResponse.json({ error: "没有要更新的字段" }, { status: 400 });

      params.push(Number(id));
      run(`UPDATE ${type} SET ${sets.join(",")} WHERE id = ?`, params);

      audit({
        userId: user.id, userName: user.name, action: "update",
        entityType: type, entityId: Number(id),
        summary: `修改${meta.label}：${values[meta.searchField] ?? "#" + id}`,
      });

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "未知操作" }, { status: 400 });
  } catch (e) {
    return errorResponse(e);
  }
}

/** 删除（有关联数据则拒绝） */
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!user.roles.includes("boss")) {
      throw new AuthError("仅总经理可删除基础数据", 403);
    }

    const sp = req.nextUrl.searchParams;
    const type = sp.get("type") ?? "";
    const id = Number(sp.get("id"));

    if (!TABLES[type] || !id) {
      return NextResponse.json({ error: "参数无效" }, { status: 400 });
    }

    // 引用检查
    const refs: Record<string, { table: string; field: string; label: string }[]> = {
      customers: [{ table: "projects", field: "customer_id", label: "项目" }],
      items: [
        { table: "stock", field: "item_id", label: "库存记录" },
        { table: "stock_moves", field: "item_id", label: "出入库单" },
      ],
      warehouses: [{ table: "stock", field: "warehouse_id", label: "库存记录" }],
    };

    for (const ref of refs[type] ?? []) {
      const cnt = one<{ c: number }>(
        `SELECT COUNT(*) AS c FROM ${ref.table} WHERE ${ref.field} = ?`,
        [id]
      )?.c ?? 0;
      if (cnt > 0) {
        return NextResponse.json(
          { error: `该记录已被 ${cnt} 条${ref.label}引用，无法删除` },
          { status: 400 }
        );
      }
    }

    run(`DELETE FROM ${type} WHERE id = ?`, [id]);

    audit({
      userId: user.id, userName: user.name, action: "delete",
      entityType: type, entityId: id,
      summary: `删除${TABLES[type].label} #${id}`,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
