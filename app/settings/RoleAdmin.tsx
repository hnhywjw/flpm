"use client";

import { useState, useEffect } from "react";
import { TotpPanel } from "./TotpPanel";

interface RoleDef {
  key: string; name: string; description: string | null;
  menus: string[]; can_see_amount: number; is_system: number;
  sort: number; active: number; user_count?: number;
}
interface UserRow {
  id: number; name: string; username: string | null; role: string; dept: string | null;
  phone: string | null; active: number; last_login_at: string | null;
  reg_status: string; reg_at: string | null;
  totp_enabled: number;
  roles: string[]; primaryRole: string; roleNames: string[];
}

const ALL_MENUS = [
  { key: "dashboard", label: "工作台" },
  { key: "projects", label: "项目管理" },
  { key: "bidding", label: "投标管理" },
  { key: "agent", label: "中标管理" },
  { key: "contracts", label: "合同管理" },
  { key: "finance", label: "开票与回款" },
  { key: "changes", label: "变更管理" },
  { key: "inventory", label: "出入库" },
  { key: "service", label: "售后服务" },
  { key: "approvals", label: "审批中心" },
  { key: "alerts", label: "待办预警" },
  { key: "reports", label: "报表分析" },
  { key: "logs", label: "操作日志" },
  { key: "settings", label: "基础数据" },
  { key: "system", label: "系统管理" },
];

export function RoleAdmin() {
  // 当前登录用户（用于禁止删除/停用自己）
  const [me, setMe] = useState<{ id: number; name: string } | null>(null);
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.user && setMe({ id: d.user.id, name: d.user.name }))
      .catch(() => {});
  }, []);

  const [tab, setTab] = useState<"roles" | "users">("roles");
  const [roles, setRoles] = useState<RoleDef[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  // 待审核数量
  const pendingCount = users.filter((u) => u.reg_status === "pending").length;
  const [msg, setMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // 角色编辑
  const [editRole, setEditRole] = useState<RoleDef | null>(null);
  const [newRole, setNewRole] = useState(false);
  const [rKey, setRKey] = useState("");
  const [rName, setRName] = useState("");
  const [rDesc, setRDesc] = useState("");
  const [rMenus, setRMenus] = useState<string[]>([]);
  const [rAmount, setRAmount] = useState(false);

  // 用户编辑
  const [editUser, setEditUser] = useState<UserRow | null>(null);
  const [newUser, setNewUser] = useState(false);
  const [uName, setUName] = useState("");
  const [uUsername, setUUsername] = useState("");
  const [uDept, setUDept] = useState("");
  const [uPhone, setUPhone] = useState("");
  const [uRoles, setURoles] = useState<string[]>([]);
  const [uPwd, setUPwd] = useState("");

  // 修改密码弹窗
  const [pwdUser, setPwdUser] = useState<UserRow | null>(null);
  const [pwdNew, setPwdNew] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdMsg, setPwdMsg] = useState<{ t: "ok" | "err"; m: string } | null>(null);
  const [pwdBusy, setPwdBusy] = useState(false);

  async function submitPwd() {
    if (!pwdUser) return;
    setPwdMsg(null);

    if (pwdNew.length < 8) {
      setPwdMsg({ t: "err", m: "密码至少 8 位" });
      return;
    }
    if (!/[a-zA-Z]/.test(pwdNew)) {
      setPwdMsg({ t: "err", m: "密码必须包含字母" });
      return;
    }
    if (!/[0-9]/.test(pwdNew)) {
      setPwdMsg({ t: "err", m: "密码必须包含数字" });
      return;
    }
    if (pwdNew !== pwdConfirm) {
      setPwdMsg({ t: "err", m: "两次输入的密码不一致" });
      return;
    }

    setPwdBusy(true);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "resetPassword",
          id: pwdUser.id,
          password: pwdNew,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setPwdMsg({ t: "err", m: d.error ?? "修改失败" });
        return;
      }
      setPwdMsg({ t: "ok", m: `已修改「${pwdUser.name}」的密码` });
      setPwdNew(""); setPwdConfirm("");
      // 如果是给自己改的，顶部「初始密码」横幅要立即消失
      if (me && pwdUser.id === me.id) {
        window.dispatchEvent(new Event("pwd-changed"));
      }
      await load();
      // 成功提示停留 1.2 秒后自动关闭弹窗，不用手动点关闭
      setTimeout(() => {
        setPwdUser(null);
        setPwdMsg(null);
      }, 1200);
    } catch (e) {
      setPwdMsg({ t: "err", m: (e as Error).message });
    } finally {
      setPwdBusy(false);
    }
  }

  async function load() {
    const res = await fetch("/api/admin/roles");
    if (res.ok) {
      const d = await res.json();
      setRoles(d.roles);
      setUsers(d.users);
    }
  }
  useEffect(() => { load(); }, []);

  async function call(payload: Record<string, unknown>, okMsg: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await res.json();
      if (!res.ok) { setMsg({ t: "err", m: d.error }); return false; }
      setMsg({ t: "ok", m: okMsg });
      await load();
      return true;
    } catch (e) {
      setMsg({ t: "err", m: (e as Error).message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openRole(r: RoleDef) {
    setEditRole(r); setNewRole(false);
    setRKey(r.key); setRName(r.name); setRDesc(r.description ?? "");
    setRMenus([...r.menus]); setRAmount(r.can_see_amount === 1);
  }
  function openNewRole() {
    setEditRole(null); setNewRole(true);
    setRKey(""); setRName(""); setRDesc(""); setRMenus(["dashboard"]); setRAmount(true);
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid var(--line)",
    borderRadius: 8, background: "var(--card)", color: "var(--text)", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 12, color: "var(--sub)", fontWeight: 600, marginBottom: 6,
  };

  return (
    <>
      <div style={{ display: "flex", gap: 6, margin: "16px 0 12px" }}>
        <button className="btn btn-sm" onClick={() => setTab("roles")}
          style={{ background: tab === "roles" ? "var(--pri-weak)" : "var(--card)",
                   borderColor: tab === "roles" ? "var(--pri-soft)" : "var(--line)",
                   fontWeight: 700, color: tab === "roles" ? "var(--pri-2)" : "var(--sub)" }}>
          角色配置 {roles.length}
        </button>
        <button className="btn btn-sm" onClick={() => setTab("users")}
          style={{ background: tab === "users" ? "var(--pri-weak)" : "var(--card)",
                   borderColor: tab === "users" ? "var(--pri-soft)" : "var(--line)",
                   fontWeight: 700, color: tab === "users" ? "var(--pri-2)" : "var(--sub)" }}>
          人员管理 {users.length}
          {pendingCount > 0 && (
            <span style={{
              marginLeft: 5, background: "var(--bad)", color: "#fff",
              fontSize: 10.5, padding: "1px 6px", borderRadius: 9, fontWeight: 700,
            }}>{pendingCount}</span>
          )}
        </button>
      </div>

      {msg && (
        <div className={msg.t === "ok" ? "notice ok" : "notice danger"} style={{ marginBottom: 12 }}>
          <div>{msg.m}</div>
        </div>
      )}

      {/* ---------- 角色 ---------- */}
      {tab === "roles" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn btn-pri btn-sm" onClick={openNewRole}>+ 新建角色</button>
            <span style={{ fontSize: 11.5, color: "var(--muted)", marginLeft: 10 }}>
              系统内置角色不可删除；菜单与金额权限可调整
            </span>
          </div>

          {(newRole || editRole) && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-h">
                <h3>{newRole ? "新建角色" : `编辑角色：${editRole?.name}`}</h3>
                <div style={{ marginLeft: "auto" }}>
                  <button className="btn btn-sm" onClick={() => { setNewRole(false); setEditRole(null); }}>
                    取消
                  </button>
                </div>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label style={labelStyle}>角色标识（小写字母开头，英文）</label>
                    <input value={rKey} onChange={(e) => setRKey(e.target.value)}
                           disabled={!newRole} placeholder="如 purchaser"
                           style={{ ...inputStyle, opacity: newRole ? 1 : 0.6 }} />
                  </div>
                  <div>
                    <label style={labelStyle}>角色名称</label>
                    <input value={rName} onChange={(e) => setRName(e.target.value)}
                           placeholder="如 采购专员" style={inputStyle} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>说明</label>
                    <input value={rDesc} onChange={(e) => setRDesc(e.target.value)}
                           placeholder="职责描述" style={inputStyle} />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>可访问菜单</label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {ALL_MENUS.map((m) => {
                        const on = rMenus.includes(m.key);
                        return (
                          <button key={m.key}
                            onClick={() => setRMenus(on ? rMenus.filter((x) => x !== m.key) : [...rMenus, m.key])}
                            style={{
                              padding: "5px 11px", fontSize: 12, borderRadius: 7, cursor: "pointer",
                              border: `1px solid ${on ? "var(--pri)" : "var(--line)"}`,
                              background: on ? "var(--pri-weak)" : "var(--card)",
                              color: on ? "var(--pri-2)" : "var(--sub)",
                              fontWeight: on ? 700 : 400,
                            }}>
                            {m.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={rAmount} onChange={(e) => setRAmount(e.target.checked)} />
                      允许查看金额（合同额、回款、过单费等）
                    </label>
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <button className="btn btn-pri" disabled={busy}
                    onClick={async () => {
                      const ok = newRole
                        ? await call({ action: "createRole", key: rKey, name: rName, description: rDesc, menus: rMenus, canSeeAmount: rAmount }, "角色已创建")
                        : await call({ action: "updateRole", key: rKey, name: rName, description: rDesc, menus: rMenus, canSeeAmount: rAmount }, "角色已更新");
                      if (ok) { setNewRole(false); setEditRole(null); }
                    }}>
                    {busy ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>角色</th><th>标识</th><th>菜单数</th><th>金额</th>
                    <th>用户数</th><th>类型</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r) => (
                    <tr key={r.key}>
                      <td><b>{r.name}</b>
                        <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{r.description ?? "—"}</div>
                      </td>
                      <td className="num" style={{ fontSize: 12 }}>{r.key}</td>
                      <td className="num">{r.menus.length}</td>
                      <td>
                        {r.can_see_amount
                          ? <span className="badge b-ok">可见</span>
                          : <span className="badge b-gray">隐藏</span>}
                      </td>
                      <td className="num">{r.user_count ?? 0}</td>
                      <td>
                        {r.is_system
                          ? <span className="badge b-pri">内置</span>
                          : <span className="badge b-vio">自定义</span>}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button className="btn btn-sm" onClick={() => openRole(r)}>编辑</button>
                          {!r.is_system && (
                            <button className="btn btn-sm" style={{ color: "var(--bad)" }}
                              disabled={busy}
                              onClick={() => {
                                if (confirm(`确定删除角色「${r.name}」？`))
                                  call({ action: "deleteRole", key: r.key }, "角色已删除");
                              }}>删除</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ---------- 人员 ---------- */}
      {tab === "users" && (
        <>
          <div style={{ marginBottom: 12 }}>
            <button className="btn btn-pri btn-sm"
              onClick={() => {
                setNewUser(true); setEditUser(null);
                setUName(""); setUUsername(""); setUDept(""); setUPhone(""); setURoles(["sales"]); setUPwd("");
              }}>+ 新增人员</button>
            <span style={{ fontSize: 11.5, color: "var(--muted)", marginLeft: 10 }}>
              一个人可分配多个角色，菜单取并集
            </span>
          </div>

          {(newUser || editUser) && (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-h">
                <h3>{newUser ? "新增人员" : `编辑人员：${editUser?.name}`}</h3>
                <div style={{ marginLeft: "auto" }}>
                  <button className="btn btn-sm" onClick={() => { setNewUser(false); setEditUser(null); }}>取消</button>
                </div>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label style={labelStyle}>姓名</label>
                    <input value={uName} onChange={(e) => setUName(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>用户名（登录用）</label>
                    <input value={uUsername} onChange={(e) => setUUsername(e.target.value)}
                           placeholder="如 wangjingli" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>部门</label>
                    <input value={uDept} onChange={(e) => setUDept(e.target.value)} style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>手机号</label>
                    <input value={uPhone} onChange={(e) => setUPhone(e.target.value)} style={inputStyle} />
                  </div>
                  {newUser && (
                    <div>
                      <label style={labelStyle}>初始密码（至少 8 位）</label>
                      <input value={uPwd} onChange={(e) => setUPwd(e.target.value)}
                             placeholder="初次登录后应修改" style={inputStyle} />
                    </div>
                  )}
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label style={labelStyle}>角色（可多选，第一个为主角色）</label>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {roles.map((r) => {
                        const on = uRoles.includes(r.key);
                        const isFirst = uRoles[0] === r.key;
                        return (
                          <button key={r.key}
                            onClick={() => setURoles(on ? uRoles.filter((x) => x !== r.key) : [...uRoles, r.key])}
                            style={{
                              padding: "5px 11px", fontSize: 12, borderRadius: 7, cursor: "pointer",
                              border: `1px solid ${on ? "var(--pri)" : "var(--line)"}`,
                              background: on ? "var(--pri-weak)" : "var(--card)",
                              color: on ? "var(--pri-2)" : "var(--sub)",
                              fontWeight: on ? 700 : 400,
                            }}>
                            {r.name}{isFirst ? " (主)" : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                  <button className="btn btn-pri" disabled={busy}
                    onClick={async () => {
                      if (newUser) {
                        const ok = await call({
                          action: "createUser", name: uName, username: uUsername,
                          dept: uDept, phone: uPhone,
                          roleKeys: uRoles, password: uPwd,
                        }, "人员已创建");
                        if (ok) { setNewUser(false); }
                      } else if (editUser) {
                        await call({ action: "updateUser", id: editUser.id, name: uName, username: uUsername, dept: uDept, phone: uPhone }, "已保存");
                        await call({ action: "setUserRoles", id: editUser.id, roleKeys: uRoles }, "角色已更新");
                        // 不关闭编辑面板：令牌认证等其他操作可能还要继续
                      }
                    }}>
                    {busy ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 令牌认证：编辑已有用户时显示 */}
          {editUser && !newUser && (
            <TotpPanel user={{ id: editUser.id, name: editUser.name }} />
          )}

          <div className="card">
            <div style={{ overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>姓名</th><th>用户名</th><th>部门</th><th>角色</th><th>手机</th>
                    <th>最近登录</th><th>状态</th><th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <b>{u.name}</b>
                        {u.totp_enabled === 1 && (
                          <span className="badge b-pri" style={{ marginLeft: 6, fontSize: 9.5 }}>
                            令牌
                          </span>
                        )}
                      </td>
                      <td className="num" style={{ fontSize: 12 }}>{u.username ?? "—"}</td>
                      <td>{u.dept ?? "—"}</td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {u.roleNames.map((n, i) => (
                            <span key={i} className={i === 0 ? "badge b-pri" : "badge b-gray"}>{n}</span>
                          ))}
                        </div>
                      </td>
                      <td className="num" style={{ fontSize: 12 }}>{u.phone ?? "—"}</td>
                      <td className="num" style={{ fontSize: 12 }}>{u.last_login_at ?? "从未"}</td>
                      <td>
                        {u.reg_status === "pending" ? (
                          <span className="badge b-warn">待审核</span>
                        ) : u.reg_status === "rejected" ? (
                          <span className="badge b-bad">已拒绝</span>
                        ) : u.active ? (
                          <span className="badge b-ok">正常</span>
                        ) : (
                          <span className="badge b-gray">停用</span>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {u.reg_status === "pending" && (
                            <>
                              <button className="btn btn-sm btn-pri" disabled={busy}
                                onClick={() => {
                                  if (confirm(`通过「${u.name}」的注册申请？\n\n通过后账号启用，但还需要分配角色才能看到菜单。`)) {
                                    call({ action: "reviewRegistration", id: u.id, approve: true }, "已通过注册申请，请分配角色");
                                  }
                                }}>通过</button>
                              <button className="btn btn-sm" style={{ color: "var(--bad)" }} disabled={busy}
                                onClick={() => {
                                  if (confirm(`拒绝「${u.name}」的注册申请？`)) {
                                    call({ action: "reviewRegistration", id: u.id, approve: false }, "已拒绝");
                                  }
                                }}>拒绝</button>
                            </>
                          )}
                          <button className="btn btn-sm" onClick={() => {
                            setEditUser(u); setNewUser(false);
                            setUName(u.name); setUUsername(u.username ?? u.name);
                            setUDept(u.dept ?? ""); setUPhone(u.phone ?? "");
                            setURoles([...u.roles]);
                          }}>编辑</button>
                          <button className="btn btn-sm" onClick={() => {
                            setPwdUser(u);
                            setPwdNew(""); setPwdConfirm(""); setPwdMsg(null);
                          }}>修改密码</button>
                          <button className="btn btn-sm" disabled={busy}
                            onClick={() => {
                              const act = u.active ? "停用" : "启用";
                              if (confirm(`${act}「${u.name}」的账号？` +
                                (u.active ? "\n\n停用后该账号立即下线，无法登录，但历史数据保留。" : ""))) {
                                call({ action: "toggleUserActive", id: u.id }, `已${act}`);
                              }
                            }}>
                            {u.active ? "停用" : "启用"}
                          </button>
                          <button className="btn btn-sm" style={{ color: "var(--bad)" }}
                            disabled={busy || u.id === me?.id}
                            title={u.id === me?.id ? "不能删除自己" : "删除该账号"}
                            onClick={() => {
                              if (confirm(`删除「${u.name}」的账号？` +
                                "\n\n删除后该账号无法登录，且不再出现在人员列表中。\n" +
                                "如果只是暂时不用，建议用「停用」。" +
                                "\n\n此操作不可撤销。")) {
                                call({ action: "deleteUser", id: u.id }, "账号已删除");
                              }
                            }}>
                            删除
                          </button>

                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* 修改密码弹窗 */}
      {pwdUser && (
        <div
          style={{
            position: "fixed", inset: 0, background: "rgba(16,26,48,.5)",
            zIndex: 95, display: "grid", placeItems: "center", padding: 16,
          }}
          onClick={() => setPwdUser(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 400, background: "var(--card)",
              borderRadius: 16, padding: "24px 24px 20px",
              boxShadow: "0 20px 60px rgba(0,0,0,.28)",
            }}
          >
            <h3 style={{ margin: "0 0 6px", fontSize: 16, fontWeight: 700, color: "var(--text)" }}>
              修改密码
            </h3>
            <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--sub)" }}>
              用户：<b style={{ color: "var(--text)" }}>{pwdUser.name}</b>
              {pwdUser.username && (
                <span style={{ color: "var(--muted)", marginLeft: 6 }}>（{pwdUser.username}）</span>
              )}
            </p>

            {pwdMsg?.t === "ok" ? (
              // 成功态：只显示结果，1.2 秒后自动关闭
              <>
                <div className="notice ok" style={{ marginBottom: 14 }}>
                  <div style={{ fontWeight: 700 }}>✓ 修改成功</div>
                  <div style={{ marginTop: 4 }}>{pwdMsg.m}</div>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center" }}>
                  窗口即将自动关闭…
                </div>
              </>
            ) : (
              <>
                <label style={labelStyle}>新密码</label>
                <input
                  type="password"
                  value={pwdNew}
                  onChange={(e) => setPwdNew(e.target.value)}
                  placeholder="至少 8 位，含字母和数字"
                  style={{ ...inputStyle, marginBottom: 12 }}
                  autoFocus
                />

                <label style={labelStyle}>确认新密码</label>
                <input
                  type="password"
                  value={pwdConfirm}
                  onChange={(e) => setPwdConfirm(e.target.value)}
                  placeholder="再次输入"
                  style={{ ...inputStyle, marginBottom: 12 }}
                />

                {pwdMsg?.t === "err" && (
                  <div className="notice danger" style={{ marginBottom: 12 }}>
                    <div>{pwdMsg.m}</div>
                  </div>
                )}

                <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 14, lineHeight: 1.7 }}>
                  修改后该用户的所有会话会被强制失效，需要用新密码重新登录。
                </div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button className="btn btn-sm" onClick={() => setPwdUser(null)}>
                    取消
                  </button>
                  <button className="btn btn-pri btn-sm" onClick={submitPwd} disabled={pwdBusy}>
                    {pwdBusy ? "提交中…" : "确认修改"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
