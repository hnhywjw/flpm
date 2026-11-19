"use client";

import { useState, useEffect } from "react";

/**
 * 投标任务进度
 *
 * 用途：这一家投标人的编标进度（商务标 / 技术标 / 投标报价 / 资质 / 用章）
 *
 * 交互设计：
 *   收起 —— 一行进度条 + 百分比，鼠标悬停显示「已完成 N/M 项」
 *   展开 —— 每项一条，拖动滑块改进度，可加/删任务项
 *
 * 为什么要做成弹出层而不是直接铺开：
 *   参与方表格已经有 8 列，再铺 5 条任务会横向撑爆。
 *   进度条占一格，点开才看细节，表格才不会失控。
 */

interface Task {
  id: number;
  title: string;
  progress: number;
  owner: string | null;
  due_date: string | null;
  note: string | null;
  seq: number;
}

/** 项目级任务（原「投标任务分解」，只读展示） */
interface BidTask {
  id: number;
  title: string;
  status: string | null;
  owner_name: string | null;
  due_date: string | null;
}

/** 进度条颜色：低红、中黄、高绿 */
function toneOf(p: number): { bar: string; text: string } {
  if (p >= 100) return { bar: "var(--ok)", text: "var(--ok)" };
  if (p >= 60) return { bar: "var(--pri)", text: "var(--pri)" };
  if (p >= 30) return { bar: "var(--warn)", text: "var(--warn)" };
  return { bar: "var(--bad)", text: "var(--bad)" };
}

export function BidTaskProgress({
  participantId,
  companyName,
  canEdit,
}: {
  participantId: number;
  companyName: string;
  canEdit: boolean;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [bidTasks, setBidTasks] = useState<BidTask[]>([]);
  const [overall, setOverall] = useState(0);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Task[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(
        "/api/bids/participants/tasks?participantId=" + participantId
      );
      if (!res.ok) return;
      const d = await res.json();
      setTasks(d.tasks ?? []);
      setOverall(d.overall ?? 0);
      setBidTasks(d.bidTasks ?? []);
    } catch {
      /* 网络失败不阻塞表格 */
    }
  }
  useEffect(() => { load(); }, [participantId]);

  function startEdit() {
    if (!tasks) return;
    setDraft(tasks.map((t) => ({ ...t })));
    setErr(null);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/bids/participants/tasks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId,
          tasks: draft.map((t) => ({
            id: t.id > 0 ? t.id : undefined,
            title: t.title,
            progress: t.progress,
            owner: t.owner,
            dueDate: t.due_date,
            note: t.note,
          })),
        }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "保存失败"); return; }
      setTasks(d.tasks ?? []);
      setOverall(d.overall ?? 0);
      setBidTasks(d.bidTasks ?? []);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const doneCnt = (tasks ?? []).filter((t) => t.progress >= 100).length;
  const total = (tasks ?? []).length;
  const tone = toneOf(overall);

  // ---- 收起态：一个进度条 ----
  const compact = (
    <button
      type="button"
      onClick={() => (canEdit ? startEdit() : setOpen((v) => !v))}
      title={`${companyName}：已完成 ${doneCnt}/${total} 项`}
      style={{
        display: "flex", alignItems: "center", gap: 7, width: "100%",
        background: "transparent", border: "none", padding: 0,
        cursor: "pointer", textAlign: "left",
      }}
    >
      <div style={{
        flex: 1, height: 6, background: "var(--line)", borderRadius: 3,
        overflow: "hidden", minWidth: 56,
      }}>
        <div style={{
          width: Math.min(100, Math.max(0, overall)) + "%",
          height: "100%", background: tone.bar,
          transition: "width .2s",
        }} />
      </div>
      <span style={{
        fontSize: 11.5, fontWeight: 700, color: tone.text,
        flex: "0 0 auto", minWidth: 32, textAlign: "right",
      }}>
        {overall}%
      </span>
    </button>
  );

  return (
    <>
      {compact}

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", inset: 0, zIndex: 300,
            background: "rgba(10,20,40,.45)", display: "grid", placeItems: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--card)", borderRadius: 13, width: "min(620px, 94vw)",
              maxHeight: "86vh", display: "flex", flexDirection: "column",
              boxShadow: "0 20px 60px rgba(0,0,0,.3)",
            }}
          >
            {/* 头 */}
            <div style={{
              padding: "14px 18px", borderBottom: "1px solid var(--line)",
              display: "flex", alignItems: "center", gap: 10,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>
                  {companyName} · 投标任务进度
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
                  已完成 {doneCnt}/{total} 项 · 总体 {overall}%
                </div>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setOpen(false)}
              >
                关闭
              </button>
            </div>

            <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
              {/* ===== 项目任务 → 本家进度：母项 + 子项，用缩进和竖线体现从属 ===== */}
              {(bidTasks.length > 0 ? bidTasks : [{ id: 0, title: "投标编制", status: null, owner_name: null, due_date: null }]).map((t, ti) => {
                // 项目任务按标题匹配到本家同名任务项，形成「母-子」关系
                const matched = draft.filter((d) => {
                  const key = String(t.title ?? "").split(/[（(]/)[0].trim();
                  return key && d.title.includes(key);
                });
                const avg = matched.length
                  ? Math.round(matched.reduce((a, b) => a + b.progress, 0) / matched.length)
                  : null;
                const isDone = t.status === "已完成";
                const isRisk = t.status === "风险";
                const tone = isDone ? "var(--ok)" : isRisk ? "var(--bad)" : "var(--warn)";
                const toneBg = isDone ? "var(--ok-weak)" : isRisk ? "var(--bad-weak)" : "var(--warn-weak)";
                return (
                  <div key={t.id || "x"} style={{ marginBottom: 10 }}>
                    {/* 母项：项目任务 */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 8,
                      background: "var(--line2)",
                    }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: 5, display: "grid",
                        placeItems: "center", flex: "0 0 18px", fontSize: 10,
                        background: toneBg, color: tone,
                      }}>
                        {isDone ? "✓" : isRisk ? "!" : "◐"}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600 }}>{t.title}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>
                          项目任务 · {t.owner_name ?? "未指派"} · 截止 {t.due_date ?? "—"}
                        </div>
                      </div>
                      {/* 本家完成度：和项目任务的官方状态分开显示，
                          两者不一致时（如项目标已完成、本家还没录完）一眼能看出来 */}
                      {avg !== null && (
                        <span
                          title={"本家这一项完成 " + avg + "%，项目任务状态：" + (t.status ?? "未设置")}
                          style={{
                            fontSize: 11, fontWeight: 700,
                            color: toneOf(avg).text,
                          }}
                        >
                          本家 {avg}%
                        </span>
                      )}
                      <span className={"badge " + (isDone ? "b-ok" : isRisk ? "b-bad" : "b-warn")}
                            style={{ fontSize: 9.5 }}>
                        项目 {t.status ?? "—"}
                      </span>
                    </div>

                    {/* 子项：本家进度（缩进 + 左侧竖线表示从属） */}
                    {matched.length > 0 && (
                      <div style={{
                        marginLeft: 9, paddingLeft: 14,
                        borderLeft: "2px solid " + toneBg,
                        marginTop: 4,
                      }}>
                        {matched.map((tt) => {
                          const idx = draft.findIndex((x) => x === tt || x.id === tt.id);
                          const tn = toneOf(tt.progress);
                          return (
                            <div key={tt.id} style={{ marginBottom: 6 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                <span style={{ fontSize: 10, color: "var(--muted)", flex: "0 0 46px" }}>
                                  本家进度
                                </span>
                                <input
                                  type="range" min={0} max={100} step={5}
                                  value={tt.progress}
                                  disabled={!canEdit}
                                  onChange={(e) => {
                                    const next = [...draft];
                                    next[idx] = { ...tt, progress: Number(e.target.value) };
                                    setDraft(next);
                                  }}
                                  style={{ flex: 1, accentColor: tn.bar }}
                                />
                                <span style={{
                                  fontSize: 11, fontWeight: 700, color: tn.text,
                                  flex: "0 0 34px", textAlign: "right",
                                }}>
                                  {tt.progress}%
                                </span>
                                <input
                                  value={tt.owner ?? ""}
                                  disabled={!canEdit}
                                  placeholder="负责人"
                                  onChange={(e) => {
                                    const next = [...draft];
                                    next[idx] = { ...tt, owner: e.target.value };
                                    setDraft(next);
                                  }}
                                  style={{
                                    width: 76, padding: "2px 5px", fontSize: 10.5,
                                    border: "1px solid var(--line)", borderRadius: 5,
                                    background: "var(--card)",
                                  }}
                                />
                                {canEdit && (
                                  <button
                                    type="button"
                                    onClick={() => setDraft(draft.filter((_, k) => k !== idx))}
                                    style={{
                                      border: "none", background: "transparent",
                                      color: "var(--bad)", cursor: "pointer", fontSize: 10.5,
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 未挂到任何项目任务下的本家任务 */}
              {(() => {
                const used = new Set();
                (bidTasks.length ? bidTasks : []).forEach((t) => {
                  const key = String(t.title ?? "").split(/[（(]/)[0].trim();
                  draft.forEach((d) => { if (key && d.title.includes(key)) used.add(d.id); });
                });
                const orphans = draft.filter((d) => !used.has(d.id));
                if (orphans.length === 0) return null;
                return (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
                      其他任务项（不属于上面任何项目任务）
                    </div>
                    {orphans.map((tt) => {
                      const idx = draft.findIndex((x) => x.id === tt.id);
                      const tn = toneOf(tt.progress);
                      return (
                        <div key={tt.id} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                          <input
                            value={tt.title}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const next = [...draft];
                              next[idx] = { ...tt, title: e.target.value };
                              setDraft(next);
                            }}
                            style={{
                              flex: "0 0 110px", padding: "2px 5px", fontSize: 10.5,
                              border: "1px solid var(--line)", borderRadius: 5,
                              background: "var(--card)",
                            }}
                          />
                          <input
                            type="range" min={0} max={100} step={5}
                            value={tt.progress}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const next = [...draft];
                              next[idx] = { ...tt, progress: Number(e.target.value) };
                              setDraft(next);
                            }}
                            style={{ flex: 1, accentColor: tn.bar }}
                          />
                          <span style={{ fontSize: 11, fontWeight: 700, color: tn.text, flex: "0 0 34px", textAlign: "right" }}>
                            {tt.progress}%
                          </span>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => setDraft(draft.filter((_, k) => k !== idx))}
                              style={{ border: "none", background: "transparent", color: "var(--bad)", cursor: "pointer", fontSize: 10.5 }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {canEdit && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginTop: 10 }}
                  onClick={() =>
                    setDraft([
                      ...draft,
                      {
                        id: 0, title: "新任务", progress: 0,
                        owner: null, due_date: null, note: null,
                        seq: draft.length + 1,
                      },
                    ])
                  }
                >
                  + 添加任务项
                </button>
              )}

            </div>

            {/* 底部 */}
            {canEdit && (
              <div style={{
                padding: "12px 16px", borderTop: "1px solid var(--line)",
                display: "flex", gap: 9, alignItems: "center",
              }}>
                {err && (
                  <span style={{ fontSize: 12, color: "var(--bad)", flex: 1 }}>{err}</span>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                  <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
                    取消
                  </button>
                  <button className="btn btn-pri" onClick={save} disabled={busy}>
                    {busy ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
