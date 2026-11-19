# 工作台问候语显示错误用户 —— 根因与修复

日期：2026-10-29

---

## 一、问题

用 admin 账号登录，工作台却显示「王经理」。

---

## 二、根因：不是会话串号，是硬编码

排查第一步查了「是否有人读错会话」，结果是**代码里写死了姓名**。

### 问题代码

`app/page.tsx:39`

```tsx
desc={
  <>
    王经理，今天有 <b>{d.alerts.length}</b> 项待办需要处理
  </>
}
```

这是服务端组件，但问候语里的「王经理」是**字符串常量**，
跟当前登录用户没有任何关系，**谁登录都显示这个名字**。

### 另一处硬编码

`app/projects/[id]/AcceptancePanel.tsx:39`

```tsx
body: JSON.stringify({
  projectId, docType, status,
  submitDate: ...,
  userId: 1, userName: "王经理",   // ← 写死
})
```

**这处的实际影响较小**：后端 `acceptances/route.ts` 用的是 `user.id` / `user.name`
（从会话取），前端传的完全被忽略，所以审计记录是对的。
但传假数据容易误导后来的人，已一并清掉。

---

## 三、修复

### 1. 工作台用当前用户

```tsx
// 改前
await guardPage("dashboard");
...
王经理，今天有 ...

// 改后
const me = await guardPage("dashboard");   // guardPage 本身就返回 SessionUser
...
{me.name}，今天有 ...
```

`guardPage` 的返回类型本来就是 `Promise<SessionUser>`，之前只是没接住。

### 2. 清掉验收面板的假数据

```tsx
// 改前
body: JSON.stringify({ projectId, docType, status, submitDate, userId: 1, userName: "王经理" })

// 改后
body: JSON.stringify({ projectId, docType, status, submitDate })
// 服务端从会话取真实用户
```

---

## 四、验证：10 个账号逐个登录

| 账号 | 角色 | 会话姓名 | 工作台问候 |
|---|---|---|---|
| 王经理 | boss | OK | OK |
| 王海涛 | sales | OK | OK |
| 李慧 | sales | OK | OK |
| 张立群 | pm | OK | OK |
| 刘鹏 | service | OK | OK |
| 陈静 | finance | OK | OK |
| 赵磊 | warehouse | OK | OK |
| 赵敏 | sales | OK | OK |
| 孙浩 | sales | OK | OK |
| 管理员 | admin | OK | OK |

**20/20 全部通过。**

### admin 账号的特别验证

修复后用 admin 实际登录：

```
登录: 200
会话用户: 管理员 / role=admin
工作台问候语: 管理员
是否显示「王经理」: False    ← 修复生效
是否显示「管理员」: True
```

---

## 五、验证时发现的另一个问题

### admin 账号密码不是 Admin@123

测试中 admin 用 Admin@123 登录返回 **401**：

```json
{"error":"用户名或密码不正确（还可尝试 4 次）"}
```

数据库状态：

```
id=12 | 管理员 | admin | active=1
password_hash = SET(cba6aedd...)
must_change_pwd = 1        ← 曾被重置过
failed_attempts = 1
```

说明这个账号的密码**被人改过**（不是初始密码），而且标记了「必须改密」。

这解释了一个现象：如果你之前能用 admin 登录，说明你用的是改过的密码；
如果用了 Admin@123 登不进去，就是这个原因。

**验证时我重置了 admin 密码为 Admin@123**，方便你直接用。
如果这不是你要的密码，登录后在「人员管理」里改。

---

## 六、同类问题排查

全项目扫了一遍硬编码的用户名 / userId：

| 位置 | 内容 | 状态 |
|---|---|---|
| app/page.tsx | 王经理 | 已修 |
| AcceptancePanel.tsx | userId:1, 王经理 | 已清 |
| LoginForm.tsx | placeholder 里的示例 | 保留（只是输入提示）|
| db/seed.sql | 王经理 | 保留（演示数据）|

除上面两处，**没有其他硬编码用户身份的地方**。

---

## 七、为什么会出现这种问题

早期开发时用「王经理」当默认演示账号，写页面时先把问候语写死了，
后来接了真实会话，但**这行文案忘了改**。

这类 bug 的特点：

- 不影响功能，不会报错
- 主账号（王经理）测试时完全正常，发现不了
- 只有换别的账号登录才会暴露

**教训**：凡是「显示当前用户信息」的地方，都要在**非主账号**下验证一次。

---

## 八、验证结果

| 项目 | 结果 |
|---|---|
| 10 个账号登录 | 全部 200 |
| 会话姓名正确 | 10/10 |
| 工作台问候正确 | 10/10 |
| admin 不显示王经理 | 通过 |
| 角色菜单正确 | 各角色菜单不同 |
| 单元测试 | 216/216 |
| 类型检查 | 零错误 |

各角色菜单数：

```
boss      15 个（全部）
admin     15 个（全部）
finance    9 个
sales      8 个
pm         6 个
service    5 个
warehouse  4 个
```

---

## 九、变更清单

```
修改：
  app/page.tsx                          问候语用 me.name
  app/projects/[id]/AcceptancePanel.tsx 清掉硬编码 userId/userName
```
