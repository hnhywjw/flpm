"use client";

import { useState, useEffect, useCallback } from "react";
import type { LoadInfo, ServiceStatus, NetIfInfo } from "@/lib/sysinfo";

interface DiskData {
  mounts: {
    path: string; purpose: string; device: string;
    totalMB: number; usedMB: number; freeMB: number; usagePct: number;
    selfSizeMB: number | null; writable: boolean;
  }[];
  dirs: {
    path: string; purpose: string; sizeMB: number;
    mount: string; mountUsagePct: number;
  }[];
  maxUsagePct: number;
  minFreeMB: number;
  supported: boolean;
}

function fmtMB(mb: number): string {
  if (mb < 1024) return mb + " MB";
  if (mb < 1024 * 1024) return (mb / 1024).toFixed(1) + " GB";
  return (mb / 1024 / 1024).toFixed(2) + " TB";
}

interface NetData {
  interfaces: NetIfInfo[];
  totalRxKBs: number | null;
  totalTxKBs: number | null;
  supported: boolean;
}

function fmtBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
  return (n / 1024 / 1024 / 1024).toFixed(2) + " GB";
}

function pct(n: number) {
  return Math.max(0, Math.min(100, n));
}

function barColor(p: number) {
  if (p >= 85) return "var(--bad)";
  if (p >= 65) return "var(--warn, #d97706)";
  return "var(--pri)";
}

function Bar({ label, value, text }: { label: string; value: number; text: string }) {
  const p = pct(value);
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 12.5, marginBottom: 6,
      }}>
        <span style={{ color: "var(--sub)", fontWeight: 600 }}>{label}</span>
        <span style={{ color: "var(--text)", fontWeight: 700 }}>{text}</span>
      </div>
      <div style={{
        height: 8, borderRadius: 5, background: "var(--line2, #eef1f5)",
        overflow: "hidden",
      }}>
        <div style={{
          width: `${p}%`, height: "100%", borderRadius: 5,
          background: barColor(p), transition: "width .4s ease",
        }} />
      </div>
    </div>
  );
}

function StatusDot({ s }: { s: "ok" | "warn" | "down" }) {
  const c = s === "ok" ? "var(--ok, #16a34a)" : s === "warn" ? "var(--warn, #d97706)" : "var(--bad)";
  const label = s === "ok" ? "正常" : s === "warn" ? "警告" : "异常";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11.5, color: c, fontWeight: 700,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: "50%", background: c,
        boxShadow: `0 0 0 3px ${s === "ok" ? "rgba(22,163,74,.16)" : s === "warn" ? "rgba(217,119,6,.16)" : "rgba(220,38,38,.16)"}`,
      }} />
      {label}
    </span>
  );
}

export function LoadPanel({
  initial,
  initialServices,
}: {
  initial: LoadInfo;
  initialServices: ServiceStatus[];
}) {
  const [load, setLoad] = useState(initial);
  const [services, setServices] = useState(initialServices);
  const [net, setNet] = useState<NetData | null>(null);
  const [disk, setDisk] = useState<DiskData | null>(null);
  const [updated, setUpdated] = useState<string>("刚刚");
  const [auto, setAuto] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/system?type=load", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setLoad(d);
        setUpdated(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
      }
      const r2 = await fetch("/api/system?type=services", { cache: "no-store" });
      if (r2.ok) {
        const d2 = await r2.json();
        setServices(d2.services ?? []);
      }
      const r3 = await fetch("/api/system?type=net", { cache: "no-store" });
      if (r3.ok) {
        setNet(await r3.json());
      }
      const r4 = await fetch("/api/system?type=disk", { cache: "no-store" });
      if (r4.ok) {
        setDisk(await r4.json());
      }
    } catch { /* 忽略 */ }
  }, []);

  // 首次拉一次网口（此时无速率），1 秒后再拉一次得到速率
  useEffect(() => {
    refresh();
    const t = setTimeout(refresh, 1200);
    return () => clearTimeout(t);
  }, [refresh]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [auto, refresh]);

  const card: React.CSSProperties = {
    background: "var(--card)", border: "1px solid var(--line)",
    borderRadius: 12, padding: 16,
  };

  return (
    <>
      {/* 顶部操作条 */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        margin: "4px 0 14px", fontSize: 12.5,
      }}>
        <button
          onClick={() => setAuto(!auto)}
          style={{
            padding: "5px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer",
            border: `1px solid ${auto ? "var(--pri)" : "var(--line)"}`,
            background: auto ? "var(--pri-weak)" : "var(--card)",
            color: auto ? "var(--pri-2)" : "var(--sub)",
            fontWeight: auto ? 700 : 400, fontFamily: "inherit",
          }}
        >
          {auto ? "● 自动刷新 5s" : "○ 自动刷新已关"}
        </button>
        <button
          onClick={refresh}
          style={{
            padding: "5px 12px", borderRadius: 7, fontSize: 12, cursor: "pointer",
            border: "1px solid var(--line)", background: "var(--card)",
            color: "var(--sub)", fontFamily: "inherit",
          }}
        >
          立即刷新
        </button>
        <span style={{ color: "var(--muted)", fontSize: 11.5, marginLeft: "auto" }}>
          更新于 {updated}
        </span>
      </div>

      {/* 服务资源占用：每个业务服务的内存 / CPU 时间 / 进程数 */}
      <div style={{
        display: "grid", gap: 12, marginBottom: 14,
        gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
      }}>
        {services.map((s) => {
          const tone = s.status === "ok" ? "var(--ok, #16a34a)"
            : s.status === "warn" ? "var(--warn, #d97706)" : "var(--bad)";
          return (
            <div key={s.key} style={card}>
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 11.5, color: "var(--muted)", marginBottom: 8,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", background: tone, flexShrink: 0,
                }} />
                <span style={{
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {s.name}
                </span>
              </div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", lineHeight: 1 }}>
                {s.memMB}
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--sub)", marginLeft: 2 }}>
                  MB
                </span>
              </div>
              <div style={{
                marginTop: 7, fontSize: 10.5, color: "var(--muted)",
                display: "flex", justifyContent: "space-between", gap: 6,
              }}>
                <span>CPU {s.cpuSec}s</span>
                <span>{s.pids.length} 进程</span>
              </div>
            </div>
          );
        })}
        {services.length === 0 && (
          <div style={{ ...card, gridColumn: "1 / -1", color: "var(--muted)", fontSize: 12.5 }}>
            暂无服务数据
          </div>
        )}
      </div>

      <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))" }}>
        {/* 负载详情 */}
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>资源占用</div>
          <Bar
            label="CPU 负载（1 / 5 / 15 分钟）"
            value={load.cpu.usagePct}
            text={`${load.cpu.load1} / ${load.cpu.load5} / ${load.cpu.load15} · ${load.cpu.cores} 核 · ${load.cpu.usagePct}%`}
          />
          <Bar
            label="内存"
            value={load.memory.usagePct}
            text={`${load.memory.usedMB} / ${load.memory.totalMB} MB · ${load.memory.usagePct}%`}
          />
          <Bar
            label="Node 堆内存"
            value={(load.process.heapUsedMB / load.process.heapTotalMB) * 100}
            text={`${load.process.heapUsedMB} / ${load.process.heapTotalMB} MB`}
          />

          <div style={{
            marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)",
            fontSize: 12, color: "var(--sub)", lineHeight: 2,
          }}>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>CPU 核数</span>
              <b style={{ color: "var(--text)" }}>{load.cpu.cores} 核</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>系统运行</span>
              <b style={{ color: "var(--text)" }}>{load.uptime.text}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Node 进程</span>
              <b style={{ color: "var(--text)" }}>
                {load.process.nodeVersion} · PID {load.process.pid}
              </b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>CPU 型号</span>
              <b style={{
                color: "var(--text)", maxWidth: 200, textAlign: "right",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }} title={load.cpu.model}>{load.cpu.model}</b>
            </div>
          </div>
        </div>

        {/* 服务状态 */}
        <div style={card}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 14 }}>业务服务状态</div>
          {services.map((s) => (
            <div
              key={s.key}
              style={{
                display: "flex", alignItems: "flex-start", gap: 10,
                padding: "11px 0", borderBottom: "1px solid var(--line2, #eef1f5)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 3,
                }}>
                  <b style={{ fontSize: 13 }}>{s.name}</b>
                  <StatusDot s={s.status} />
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
                  {s.detail}
                </div>
              </div>
              {s.metric && (
                <div style={{
                  fontSize: 11.5, color: "var(--sub)", fontWeight: 600,
                  whiteSpace: "nowrap", paddingTop: 2,
                }}>
                  {s.metric}
                </div>
              )}
            </div>
          ))}
          <div style={{ marginTop: 12 }}>
            <a href="/system/services" style={{
              fontSize: 12, color: "var(--pri)", fontWeight: 600,
              textDecoration: "none",
            }}>
              查看详细状态 →
            </a>
          </div>
        </div>
      </div>

      {/* 网口流量：独立一行，在「资源占用」与「业务服务状态」下方 */}
      <div style={{ ...card, marginTop: 14 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
          }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>网口流量</span>
            {net?.supported ? (
              <>
                <span style={{
                  fontSize: 11.5, color: "var(--ok, #16a34a)", fontWeight: 700,
                }}>
                  ↓ {net.totalRxKBs !== null ? net.totalRxKBs + " KB/s" : "采样中…"}
                </span>
                <span style={{
                  fontSize: 11.5, color: "var(--pri)", fontWeight: 700,
                }}>
                  ↑ {net.totalTxKBs !== null ? net.totalTxKBs + " KB/s" : "采样中…"}
                </span>
              </>
            ) : (
              <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
                当前环境不支持网口采集（需 Linux /proc/net/dev）
              </span>
            )}
          </div>

          {net?.supported && net.interfaces.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>网口</th>
                    <th>实时下载</th>
                    <th>实时上传</th>
                    <th>累计接收</th>
                    <th>累计发送</th>
                    <th>收/发包</th>
                    <th>错误</th>
                  </tr>
                </thead>
                <tbody>
                  {net.interfaces.map((i) => (
                    <tr key={i.name}>
                      <td><b>{i.name}</b></td>
                      <td className="num" style={{ color: "var(--ok, #16a34a)", fontWeight: 700 }}>
                        {i.rxKBs !== null ? i.rxKBs + " KB/s" : "—"}
                      </td>
                      <td className="num" style={{ color: "var(--pri)", fontWeight: 700 }}>
                        {i.txKBs !== null ? i.txKBs + " KB/s" : "—"}
                      </td>
                      <td className="num">{fmtBytes(i.rxBytes)}</td>
                      <td className="num">{fmtBytes(i.txBytes)}</td>
                      <td className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                        {i.rxPackets} / {i.txPackets}
                      </td>
                      <td>
                        {i.hasError ? (
                          <span className="badge b-warn">{i.rxErrors + i.txErrors}</span>
                        ) : (
                          <span className="badge b-ok">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : net?.supported ? (
            <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "10px 0" }}>
              未检测到物理网口（容器可能使用 host 网络或虚拟网卡）
            </div>
          ) : null}

          <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.7 }}>
            速率按两次采样的差值计算，首次加载时显示「—」属正常。
            累计值为网卡启动以来的总流量（重启容器不清零，网卡重置才归零）。
          </div>
        </div>

      {/* 存储空间 */}
      <div style={{ ...card, marginTop: 14 }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
          flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>存储空间</span>
          {disk?.supported && (
            <>
              <span style={{
                fontSize: 11.5, fontWeight: 700,
                color: disk.maxUsagePct >= 85 ? "var(--bad)"
                     : disk.maxUsagePct >= 65 ? "var(--warn, #d97706)"
                     : "var(--ok, #16a34a)",
              }}>
                最高使用率 {disk.maxUsagePct}%
              </span>
              <span style={{
                fontSize: 11.5,
                color: disk.minFreeMB < 5120 ? "var(--bad)" : "var(--sub)",
              }}>
                最小剩余 {fmtMB(disk.minFreeMB)}
              </span>
            </>
          )}
          {!disk?.supported && (
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>
              当前环境无法获取分区容量
            </span>
          )}
        </div>

        {disk?.supported && disk.mounts.length > 0 ? (
          <>
            {/* 分区水位 */}
            <div style={{ marginBottom: 18 }}>
              {disk.mounts.map((m) => {
                const p = m.usagePct;
                const color = p >= 85 ? "var(--bad)" : p >= 65 ? "var(--warn, #d97706)" : "var(--pri)";
                return (
                  <div key={m.path} style={{ marginBottom: 14 }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "baseline", gap: 10, marginBottom: 6,
                      fontSize: 12.5, flexWrap: "wrap",
                    }}>
                      <span style={{ color: "var(--sub)", fontWeight: 600 }}>
                        分区 <code style={{
                          fontSize: 11.5, background: "var(--bg)",
                          padding: "1px 5px", borderRadius: 4,
                        }}>{m.path}</code>
                        {m.device && (
                          <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 6 }}>
                            {m.device}
                          </span>
                        )}
                      </span>
                      <span style={{ color: "var(--text)", fontWeight: 700 }}>
                        {fmtMB(m.usedMB)} / {fmtMB(m.totalMB)}
                        <span style={{ color, marginLeft: 8 }}>{p}%</span>
                        <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>
                          剩余 {fmtMB(m.freeMB)}
                        </span>
                      </span>
                    </div>
                    <div style={{
                      height: 10, borderRadius: 6,
                      background: "var(--line2, #eef1f5)", overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${Math.min(100, p)}%`, height: "100%",
                        borderRadius: 6, background: color,
                        transition: "width .4s ease",
                      }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 业务目录占用 */}
            <div style={{ overflowX: "auto" }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>目录</th>
                    <th>用途</th>
                    <th>占用</th>
                    <th>所在分区</th>
                    <th>分区水位</th>
                  </tr>
                </thead>
                <tbody>
                  {disk.dirs.map((d) => {
                    const p = d.mountUsagePct;
                    const color = p >= 85 ? "var(--bad)" : p >= 65 ? "var(--warn, #d97706)" : "var(--ok, #16a34a)";
                    return (
                      <tr key={d.path}>
                        <td className="num" style={{ fontSize: 11.5 }}>{d.path}</td>
                        <td>{d.purpose}</td>
                        <td className="num" style={{ fontWeight: 700 }}>{fmtMB(d.sizeMB)}</td>
                        <td className="num" style={{ fontSize: 11.5, color: "var(--muted)" }}>
                          {d.mount}
                        </td>
                        <td>
                          <span className={p >= 85 ? "badge b-bad" : p >= 65 ? "badge b-warn" : "badge b-ok"}>
                            {p}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : disk && !disk.supported ? (
          <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "10px 0" }}>
            当前容器环境不支持分区容量查询（需 Linux 且挂载了 /proc）
          </div>
        ) : null}

        <div style={{ marginTop: 10, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.7 }}>
          容器内看到的是<b>宿主机分区容量</b>（bind mount 透传），即真实磁盘水位。
          使用率超 65% 显示黄色，超 85% 显示红色。
          剩余空间低于 5GB 时需及时清理。
        </div>
      </div>

    </>
  );
}
