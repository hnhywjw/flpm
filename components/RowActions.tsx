"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormModal, type Field } from "./FormModal";

/**
 * 通用「编辑 / 删除」按钮组
 * 放在表格行内，自动处理弹窗、确认、刷新
 */
export function RowActions({
  id,
  label,
  apiPath,
  editFields,
  editTitle,
  deleteHint,
  onDone,
  transform,
  onFieldChange,
  compact = true,
  method = "PATCH",
  version,
}: {
  id: number;
  /** 实体名称，用于提示文案 */
  label: string;
  /** API 路径，编辑走 PATCH，删除走 DELETE?id= */
  apiPath: string;
  /** 编辑字段；为空则不显示编辑按钮 */
  editFields?: Field[];
  editTitle?: string;
  /** 删除时额外提示 */
  deleteHint?: string;
  /** 删除或保存成功后的回调。客户端自己拉数据的页面要用它刷新，router.refresh 刷不到。 */
  onDone?: () => void;
  /** 编辑提交前把表单值转换为 API 需要的字段名 */
  transform?: (v: Record<string, string | boolean>) => Record<string, unknown>;
  /** 字段联动，例如费率变化时回填开票额 */
  onFieldChange?: (
    key: string,
    value: string | boolean,
    vals: Record<string, string | boolean>,
  ) => Record<string, string | boolean> | void;
  compact?: boolean;
  /** 编辑用的 HTTP 方法，默认 PATCH */
  method?: "PATCH" | "PUT";
  /** 乐观锁版本号，传入后服务端会校验 */
  version?: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const cls = compact ? "btn btn-sm" : "btn";

  async function doDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`${apiPath}?id=${id}`, { method: "DELETE" });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(d.error ?? "删除失败");
        return;
      }
      router.refresh();
      onDone?.();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", gap: 5 }}>
        {editFields && editFields.length > 0 && (
          <button className={cls} onClick={() => setEditing(true)}>编辑</button>
        )}
        <button
          className={cls}
          style={{ color: "var(--bad)" }}
          disabled={deleting}
          onClick={() => {
            if (confirm(`确定删除该${label}？\n\n${deleteHint ?? "删除后将从列表隐藏，数据仍保留在数据库中（可由管理员恢复）。"}`)) {
              doDelete();
            }
          }}
        >
          {deleting ? "…" : "删除"}
        </button>
      </div>

      {editFields && editFields.length > 0 && (
        <FormModal
          open={editing}
          title={editTitle ?? `编辑${label}`}
          fields={editFields}
          submitText="保存修改"
          onClose={() => setEditing(false)}
          onFieldChange={onFieldChange}
          onSubmit={async (v) => {
            const payload = transform ? transform(v) : v;
            const res = await fetch(apiPath, {
              method,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id, ...payload, ...(version !== undefined ? { expectedVersion: version } : {}) }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) return d.error ?? "保存失败";
            router.refresh();
            onDone?.();
            return null;
          }}
        />
      )}
    </>
  );
}
