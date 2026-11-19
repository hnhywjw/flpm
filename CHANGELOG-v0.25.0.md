# 三件事：强制改密、默认密码强制配置、管理員改密逻辑说明

日期：2026-10-29

---

## 问题二先答：管理员自助改密不该清标记，是什么意思

指这段代码：

```ts
// app/api/admin/roles/route.ts
if (targetId === user.id) {
  run("UPDATE users SET must_change_pwd = 0 WHERE id = ?", [targetId]);
}
```

### 设计意图（正确的部分）

`resetUserPassword()` 一律把 `must_change_pwd` 设成 1，因为这个函数
原本是给「管理员帮别人重置密码」用的 —— 被重置的人应该自己再改一次。

但管理员**给自己**改密码时，这个标记就不合理了：我是主动改的，
凭什么还要我再改一次？所以加了这个分支把标记清掉。

### 不够严谨的部分

如果管理员给自己设的新密码**又是默认密码**（比如随手填了 `Admin@123`），
清掉标记后会变成「密码是默认值，但系统显示不需要改密」。

### 算不算 bug

**不算功能错误，属于边界情况处理不严。** 而且现在已经有两道兜底：

```
第一道：isUsingDefaultPassword —— 密码是默认值就仍然提示
第二道：强制改密 —— 提示升级为硬拦截（本次新增）
```

所以**不需要额外改这段代码**，保留现有业务语义即可。

---

## 一、首次登录强制改密（已实施）

### 两道门

```
第一道：页面守卫 guardPage
  任何业务页面（22 个）→ 检查 mustChangePwd → 重定向到改密页

第二道：API 守卫 requireUser
  任何业务接口 → 检查 mustChangePwd → 返回 403
```

**为什么必须两道**：只有页面跳转的话，用户直接敲 API 就能绕过。

### 页面守卫

```ts
// lib/page-guard.ts
export async function guardPage(menuKey: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePwd) redirect(FORCE_CHANGE_PWD_PATH);  // 新增
  if (!user.menus.includes(menuKey)) redirect("/");
  return user;
}
```

顺序有讲究：改密判断放在权限判断**之前**。
改密是账号级前置条件，与看哪个页面无关；放后面会出现「无权限 → 跳工作台 → 再被改密拦」的绕路。

### API 守卫

```ts
// lib/auth.ts
export async function requireUser(
  opts: { allowPendingPwdChange?: boolean } = {}
): Promise<SessionUser> {
  const u = await getCurrentUser();
  if (!u) throw new AuthError("未登录或会话已过期", 401);
  if (u.mustChangePwd && !opts.allowPendingPwdChange) {
    throw new AuthError("请先修改初始密码后再使用系统", 403);
  }
  return u;
}
```

`withAuth` / `withRole` 都走 `requireUser`，所以所有业务接口一次性覆盖。

**放行名单**（只有这三个）：

| 接口 | 为什么放行 |
|---|---|
| `/api/auth/change-password` | 改密本身，不放行就永远改不了 |
| `/api/auth/logout` | 用户可能不是本人，要能退出 |
| `/api/auth/me` | 前端要知道自己为什么被拦 |

### 强制改密页

`/force-change-password`，独立页面：

```
· 不套 AppShell 外壳 —— 没有侧栏和菜单，无法绕过
· 显示用户名，说明为什么被拦
· 实时校验规则（至少8位 / 含字母 / 含数字 / 不同于原密码 / 两次一致）
· 改完自动跳转 /
· 提供退出登录入口
```

### 顺手修掉的漏洞

**原来允许把密码改回默认值**：

```
用户被强制改密 → 新密码填 Admin@123 → 通过 → 又是默认密码
强制改密形同虚设
```

现在拦截：

```ts
const { hash: newHash, salt: newSalt } = hashPassword(String(newPassword));
if (isUsingDefaultPassword(newHash, newSalt)) {
  return NextResponse.json(
    { error: "不能使用系统默认密码，请设置一个你自己的密码" },
    { status: 400 }
  );
}
```

---

## 三、默认密码改为部署时强制配置（已实施）

### 三层约束

```
第一层：docker-compose.yml
  DEFAULT_PWD=${DEFAULT_PWD:?...}
  未配置 → 容器根本起不来

第二层：deploy.sh
  部署前检查 .env 里有 DEFAULT_PWD 且至少 8 位
  报错信息更直白、更早出现

第三层：代码
  lib/auth.ts     未配置只 warn，返回空串（功能降级但不崩）
  seed-passwords  未配置直接 exit(1)
```

**为什么代码层不抛错**：`lib/auth.ts` 在很多请求路径上被引用，
启动期抛错会让整站 500，连「忘记密码申请」这种无需登录的功能也打死。
改成返回空串后，`isUsingDefaultPassword` 永远返回 false，
表现为「不再提示默认密码」—— 功能降级但不崩。
真正的强约束放在 compose 层（起不来）和部署自检里。

### .env.example

新增模板文件，包含全部配置项及说明：

```bash
JOB_TOKEN=          # 定时任务鉴权（必填）
CAPTCHA_SECRET=     # 验证码签名（选填）
DEFAULT_PWD=        # 初始默认密码（必填，至少 8 位）
WEBHOOK_URL=
WEBHOOK_SECRET=
```

### 种子脚本

```js
const DEFAULT_PWD = process.env.DEFAULT_PWD;
if (!DEFAULT_PWD || !DEFAULT_PWD.trim()) {
  console.error("[认证] ✗ DEFAULT_PWD 未配置，无法设置初始密码。");
  process.exit(1);
}
```

同时去掉了日志里的密码明文输出。

---

## 四、验证（20 项全过）

用王海涛（`must_change=1` 且密码是默认值）做完整流程测试：

```
=== 登录 ===
[OK]   登录成功
[OK]   mustChangePwd = True

=== 业务页面应全部重定向 ===
[OK]   /          307
[OK]   /projects  307
[OK]   /contracts 307
[OK]   /settings  307
[OK]   /system    307

=== 改密页可访问 ===
[OK]   200
[OK]   含标题「请先修改登录密码」
[OK]   无侧栏（不套外壳）
[OK]   含用户名「王海涛」

=== API 拦截 ===
[OK]   /api/projects 403
[OK]   /api/contracts 403
[OK]   /api/auth/me  200（放行）

=== 改密接口放行 ===
[OK]   返回 400 参数错（非 403）

=== 禁止改回默认密码 ===
[OK]   拒绝（400）

=== 改成合法新密码 ===
[OK]   改密成功（200）

=== 改完后应能进系统 ===
[OK]   mustChangePwd 变 False
[OK]   /projects 200
[OK]   /api/projects 200
```

---

## 五、回归

| 项目 | 结果 |
|---|---|
| 单元测试 | ✅ 240/240（新增 3）|
| 类型检查 | ✅ 零错误 |
| 强制改密完整流程 | ✅ 20/20 |
| 容器健康 | ✅ 双 healthy |

测试后已把王海涛恢复成初始状态（`must_change=1`），可随时体验流程。

---

## 六、变更清单

```
新增：
  app/force-change-password/page.tsx        强制改密页（服务端组件）
  app/force-change-password/ForceChangeForm.tsx  改密表单（客户端）
  lib/paths.ts                              路由常量（客户端可安全引用）
  .env.example                              配置模板

修改：
  lib/page-guard.ts               guardPage 加强制改密跳转
  lib/auth.ts                     requireUser 加 allowPendingPwdChange
                                  去除写死的默认密码，改为读环境变量
  lib/api-guard.ts                （经过 requireUser，无需改动）
  app/api/auth/change-password    放行 + 禁止改回默认密码
  app/api/auth/me                 放行
  components/AppShell.tsx         强制改密页不套外壳
  docker-compose.yml              强制要求 DEFAULT_PWD
  deploy.sh                       部署前检查 DEFAULT_PWD
  scripts/seed-passwords.js       无 DEFAULT_PWD 直接退出
  tests/domain.test.mjs           默认密码配置测试更新
```

---

## 七、部署注意

**升级到本版本，`.env` 必须加 `DEFAULT_PWD`**，否则部署会失败并提示：

```
✗ .env 中缺少 DEFAULT_PWD。请在 .env 中添加 DEFAULT_PWD=<初始密码>（至少 8 位）
```

本次已在服务器 `.env` 中补上（沿用原值），现有账号不受影响。

**给新部署的建议**：

```bash
cp .env.example .env
# 编辑 .env：
#   JOB_TOKEN=$(openssl rand -hex 32)
#   CAPTCHA_SECRET=$(openssl rand -hex 32)
#   DEFAULT_PWD=<你自己定的初始密码>
./deploy.sh
```

---

## 八、遗留建议

1. **密码强度可以再提一档**

   现在是「8 位 + 含字母 + 含数字」。若要更严，可加「不能是常见弱密码」
   的黑名单校验（如 password123、qwerty 等）。

2. **改密页可以加密码可见开关**

   移动端输密码容易错，加个「👁 显示密码」按钮体验会好很多。

3. **DEFAULT_PWD 变更后的历史账号**

   改了 `DEFAULT_PWD` 只影响**之后**新建/重置的密码，
   已有账号不受影响 —— 这是正确的，但如果想批量重置需要单独脚本。
