# 用默认密码却不提示改密 —— 修复记录

日期：2026-10-29

---

## 一、现象

王经理用 `Admin@123` 登录，系统没有任何改密提示。
但其他 8 个用户都正常提示。

---

## 二、查证

先确认两件事：

```
王经理 must_change_pwd = 0        ← 没有标记
当前密码是否为 Admin@123 = 是      ← 但密码就是默认值
```

其他用户：

```
id=1  王经理   must_change_pwd=0   ← 异常
id=2  王海涛   must_change_pwd=1
id=3  李慧     must_change_pwd=1
id=4  张立群   must_change_pwd=1
id=5  刘鹏     must_change_pwd=1
id=6  陈静     must_change_pwd=1
id=7  赵磊     must_change_pwd=1
id=8  赵敏     must_change_pwd=1
id=9  孙浩     must_change_pwd=1
id=12 管理员   must_change_pwd=0
```

### 标记为什么被清掉的

是我之前验证「改密后横幅自动消失」时，用王经理账号点了「修改密码」，
走的是这个分支：

```ts
// app/api/auth/change-password/route.ts
"UPDATE users SET password_hash = ?, password_salt = ?, must_change_pwd = 0 WHERE id = ?"
```

改完之后密码又被重置回 `Admin@123`（我做批量测试时 seed 过），
但标记已经是 0 了 —— 于是进入「密码是默认值 + 标记说不改」的矛盾状态。

---

## 三、这不只是数据问题

如果只是把标记改回 1，下次还可能再发生。

**根本设计缺陷**：`must_change_pwd` 是「一次性事件标记」，
只记录「曾经被要求改密」，不记录「现在密码是什么」。

```
问题场景：
  1. 管理员重置某用户密码 → 标记 = 1
  2. 用户改了密码          → 标记 = 0
  3. 管理员又重置回默认密码 → 标记 = 1  （这条路径是对的）

但如果中间任何一步标记被绕过（人工改库 / 代码分支遗漏）：
  用户密码 = 默认值，标记 = 0  →  永不提醒  ✗
```

---

## 四、修复

### 双重判据

```ts
// lib/auth.ts
const flagged = (pwd?.m ?? 0) === 1;                    // 被标记过
const stillDefault = !flagged && isUsingDefaultPassword(pwd?.h, pwd?.s);  // 实际是默认密码

return {
  ...
  mustChangePwd: flagged || stillDefault,   // 两者取或
};
```

### 怎么判断「是默认密码」

```ts
const DEFAULT_PASSWORD = process.env.DEFAULT_PWD ?? "Admin@123";

export function isUsingDefaultPassword(hash, salt) {
  if (!hash || !salt) return false;
  return verifyPassword(DEFAULT_PASSWORD, hash, salt);  // scrypt 实际比对
}
```

**代价**：一次 scrypt 计算，约 30-50ms。只在登录和取会话时执行，可以接受。

**为什么不用「密码哈希等于某个固定值」**：每个用户的 salt 不同，哈希必然不同，必须用明文试算。

### 顺手修掉横幅的闪烁

`PasswordWarning` 原来也是客户端 `useEffect` 拉接口：

```
首帧 → 无横幅 → 接口返回 → 横幅出现  ← 会跳一下
```

既然 `layout` 已经服务端取了 `user`，顺手把 `mustChangePwd` 一起传下去：

```tsx
<AppShell
  initialMenus={user?.menus ?? null}
  initialMustChangePwd={user?.mustChangePwd ?? false}
>
```

```tsx
function PasswordWarning({ initial = false }) {
  const [need, setNeed] = useState(initial);   // 首帧就对
}
```

---

## 五、验证

### 王经理（must_change_pwd=0，密码是默认值）

```
登录 200
mustChangePwd = True                ← 兜底判断生效
服务端 HTML 直接含「安全提醒」        ← 无闪烁
服务端 HTML 含「去修改密码」
```

### 其他账号

```
王海涛  有改密提示
陈静    有改密提示
```

### 菜单权限没被影响

```
销售账号无「报表分析」
销售账号有「审批中心」
```

### 汇总

| 项目 | 结果 |
|---|---|
| 单元测试 | ✅ 237/237（新增 6）|
| 类型检查 | ✅ 零错误 |
| 王经理改密提示 | ✅ |
| HTML 无闪烁直接含横幅 | ✅ |
| 菜单权限 | ✅ 不受影响 |
| 页面 200 | ✅ |

---

## 六、变更清单

```
修改：
  lib/auth.ts               新增 isUsingDefaultPassword()
                            buildSessionUser 改为 标记 OR 默认密码
  app/layout.tsx            透传 initialMustChangePwd
  components/AppShell.tsx   接收并传给 PasswordWarning
  tests/domain.test.mjs     新增 6 个测试
```

---

## 七、改进建议（未实施）

1. **默认密码不应写死在代码里**

   现在是 `process.env.DEFAULT_PWD ?? "Admin@123"`，
   建议部署时强制要求配置 `DEFAULT_PWD`，未配置则拒绝启动。

2. **首次登录应阻断而非提示**

   目前只是顶部横幅提醒，用户可以直接忽略继续用。
   如果安全要求高，应该强制跳转到改密页、改完才能进系统。

3. **管理员自助改密不该清标记**

   `resetPassword` 里 `targetId === user.id` 时清标记，
   本意是「自己改自己的密码，不需要再改一次」。
   但如果管理员改出来的密码又是默认值，就会漏掉提醒。
   现在有兜底判断兜住了，逻辑上可以接受。
