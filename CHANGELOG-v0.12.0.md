# 安全整改与端到端验证报告

日期：2026-10-29

---

## 一、安全整改（10 项，全部完成）

| # | 问题 | 修复 | 验证 |
|---|---|---|---|
| 1 | `/api/admin/roles` 缺管理员校验 | GET 加 `requireAdmin` | 库管 403，管理员 200 ✅ |
| 2 | 5 个接口未遮蔽金额 | 统一 `applyAmountMask` | 库管金额全为 null，管理员正常 ✅ |
| 3 | 节点 late 状态永不置位 | 加 `syncNodeLateStatus` | 实测 cur→late，触发推送 ✅ |
| 4 | 验证码密钥硬编码 | 未配置时进程内随机生成 | ✅ |
| 5 | JOB_TOKEN 空时跳过验证 | 改为 `!expected \|\| token !== expected` | 伪造 token 被拒 ✅ |
| 6 | 阶段计算缺 ORDER BY | 加 `ORDER BY seq` | ✅ |
| 7 | `/api/jobs` GET 只检查登录 | 加管理员校验 | 库管 403 ✅ |
| 8 | `auth/me` 用静态 menus | 改用 `u.menus` | 与会话一致 ✅ |
| 9 | 上传无魔数校验 | 加 `validateMagic` | 伪装 PDF 被拦、exe 被拦 ✅ |
| 10 | 全员默认密码 | 迁 020 + 提醒横幅 | 10 用户已标记 ✅ |

### 逐项说明

**第 1 项**

```ts
// 改前：只检查登录
await requireUser();
return NextResponse.json({ roles, users });   // 任何登录用户都能读全部用户

// 改后
const user = await requireUser();
requireAdmin(user);
```

**第 2 项**：新建 `lib/mask.ts`，在 API 层统一遮蔽 `*_cents` 字段。

覆盖：`contracts`、`projects`（列表）、`changes`。
`invoices` 无 GET 接口，无需处理。

**第 3 项**：这是业务逻辑缺陷，不是安全问题。

```ts
function syncNodeLateStatus() {
  // 超期未完成 → late
  run(`UPDATE project_nodes SET status='late'
       WHERE status IN ('cur','next')
         AND plan_date < date('now','localtime')
         AND actual_date IS NULL`);
  // 计划期被改到未来的 → 还原 cur
  run(`UPDATE project_nodes SET status='cur'
       WHERE status='late' AND plan_date >= date('now','localtime')`);
}
```

在 `jobNodeOverdue()` 开头调用，确保提醒能查到数据。

实测：节点 17 从 `cur` 自动变 `late`，`cur:7→6, late:2→3`，推送 2 条。

**第 4 项**：不改成「必须配环境变量否则报错」，因为那样会让系统起不来。

```ts
// 未配 CAPTCHA_SECRET 时，进程启动随机生成
const CAPTCHA_SECRET = (() => {
  const fromEnv = process.env.CAPTCHA_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  return crypto.randomBytes(32).toString('hex');
})();
```

代价：进程重启后旧验证码失效（最长 5 分钟）。生产建议显式配置。

**第 5 项**

```ts
// 改前：expected 为空 → 条件短路 → 放行
if (expected && token !== expected) return 403;

// 改后：没配 token 就完全禁止 token 通道
if (!expected || token !== expected) return 403;
```

**第 9 项**：魔数校验表

| 类型 | 魔数 |
|---|---|
| PDF | `%PDF` |
| PNG | `\x89PNG` |
| JPEG | `\xFF\xD8\xFF` |
| ZIP/DOCX/XLSX/PPTX | `PK\x03\x04` |
| DOC/XLS/PPT（老版） | `\xD0\xCF\x11\xE0` |

文本类（txt/csv/md）另做检查：拒绝含 `<script>` 或 NUL 字节。

**第 10 项**：不做强制拦截（会把人锁死），改为顶部横幅提醒 + 去修改链接。

管理员重置密码时自动置 `must_change_pwd = 1`，用户改密后自动清除。

---

## 二、【新发现】附件下载接口缺失

这是在端到端验证时发现的，**比前面 10 项更影响实际使用**。

### 现象

```
前端 AttachmentPanel.tsx:141 早已有下载按钮：
  <a href={`/api/attachments/download?id=${a.id}`}>下载</a>

但后端没有 app/api/attachments/download/route.ts 这个文件
→ 所有附件下载都是 404
```

**上传的文件躺在磁盘上，用户永远拿不回来。**

### 修复

新建 `app/api/attachments/download/route.ts`：

```ts
const abs = resolveFile(row.file_path);   // 复用已有的路径穿越防护
const buf = fs.readFileSync(abs);

return new NextResponse(buf, {
  headers: {
    'Content-Type': row.mime_type || 'application/octet-stream',
    // 强制下载，不让浏览器内联渲染（防存储型 XSS）
    'Content-Disposition': `attachment; filename*=UTF-8''${safeName}`,
    'X-Content-Type-Options': 'nosniff',
  },
});
```

### 验证

```
下载 HTTP: 200
文件大小: 77 (原始 77)
MD5: e4faf65291c537ad6b6ff43ffe557798
原文件 MD5: e4faf65291c537ad6b6ff43ffe557798   ← 完全一致
Content-Disposition: attachment   ← 强制下载
未登录下载: 401                    ← 鉴权有效
不存在的附件: 404
```

---

## 三、【澄清】金额单位不是 bug

验证时发现 `budgetWan=88.5` 存进库是 `885000`，一度怀疑金额算错 100 倍。

### 核查结论

```
全系统 15 处写入用 * 10000
全系统 16 处读取用 / 10000
→ 读写两端一致，业务数字正确
```

实测：页面上 `HT2026-0093` 显示 **88.50 万**，输入就是 88.5 万。闭环正确。

### 真正的问题

| 项 | 实际 | 名字 |
|---|---|---|
| 单位 | 1/10000 万元（即「元」） | 叫 `_cents`（「分」） |
| 常量 | `WAN = 10_000` | 注释写「1 万元 = 10000 分」 |

**命名和注释误导**，但数值自洽。

### 处理方式

不改换算逻辑（改要迁移全库金额 + 改 30 多处，风险远大于收益），
只在 `lib/domain.ts` 顶部写清单位说明，并标注「新代码用 wanToFen/fenToWan，不要手写 10000」。

---

## 四、端到端业务验证

### 4.1 真实写入数据库

| 验证 | 结果 |
|---|---|
| 新建客户 | ✅ API 200，落库 id=14 |
| 客户姓名/电话/地址 | ✅ 中文完整落库 |
| 新建项目 | ✅ `P2026-031` |
| 预算存为 885000（88.5万刻度） | ✅ |
| 客户关联 `customer_id=14` | ✅ |
| 自动生成 11 个节点 | ✅ |
| 首节点 status=cur | ✅ |
| 新建合同 | ✅ `HT2026-0093` |
| 合同关联项目 | ✅ `project_id=14` |
| 自动生成 3 期回款 | ✅ 30%/60%/10% |
| 回款合计 = 合同额 | ✅ 885000 = 885000 |
| 回款计划日期非空 | ✅ |

实际数据：

```
首笔款 30%  30%  265500  计划2026-11-05  未到期
进度款 60%  60%  531000  计划2026-12-05  未到期
质保金 10%  10%   88500  计划2027-10-29  未到期
```

### 4.2 附件上传下载

| 验证 | 结果 |
|---|---|
| PDF 上传 | ✅ 200 |
| DB 记录落库 | ✅ id=8 |
| 实体关联 | ✅ project#14 |
| 文件真实落盘 | ✅ `/app/uploads/project/14/43dfadf9-....pdf` |
| 文件大小一致 | ✅ 77 字节 |
| **下载** | ✅ 200，**MD5 完全一致** |
| 伪装 PDF（sh 脚本改名） | ✅ 400 拦截 |
| .exe 上传 | ✅ 400 拦截 |
| 未登录下载 | ✅ 401 |

### 4.3 流程状态流转

| 验证 | 结果 |
|---|---|
| 节点推进 | ✅ `招标` cur→done |
| 记录实际日期 | ✅ 2026-10-29 |
| 下一节点激活 | ✅ `投标` next→cur |
| 项目进度自动计算 | ✅ 0% → 10% |
| 验收资料未齐拦截 | ✅ 400「缺少：安装配置文档、到货签收单…」|

### 4.4 回款与开票

| 验证 | 结果 |
|---|---|
| 回款登记 | ✅ 实收 100000 |
| 状态自动变更 | ✅ 未到期 → 部分回款 |
| 超额回款拦截 | ✅ 400「累计 1009.00 万超过计划 26.55 万」|
| 验收未齐开票拦截 | ✅ 400 |

### 4.5 关联一致性复查

```
合同额:     885000
回款计划合计: 885000   ✅ 相等
实收合计:   100000
有回款期次:  1
```

---

## 五、回归测试

| 项目 | 结果 |
|---|---|
| 单元测试 | **202/202** ✅ |
| 类型检查 | 零错误 ✅ |
| 安全整改验证 | 12/12 ✅ |
| 节点状态同步 | 2/2 ✅ |
| 业务写入 | 12/12 ✅ |
| 附件（含下载） | 15/15 ✅ |
| 流程流转 | 6/6 ✅ |
| 回款开票 | 7/7 ✅ |

---

## 六、测试数据清理

E2E 测试产生的数据已全部删除：

```
项目 14       0 条  ✅
合同 17       0 条  ✅
客户 13/14    0 条  ✅
附件 DB 记录   已清  ✅
磁盘文件       已删  ✅
E2E 通知       已清  ✅
```

---

## 七、仍存在的风险与建议

### 建议尽快处理

**1. 配置 CAPTCHA_SECRET**

现在未配置，用进程内随机密钥。重启后旧验证码失效（用户重取即可），但多实例部署会出问题。

```yaml
# docker-compose.yml
environment:
  - CAPTCHA_SECRET=<32位随机字符串>
  - JOB_TOKEN=<32位随机字符串>
```

**注意**：配了 JOB_TOKEN 后，`scripts/scheduler.js` 也要同步用这个值，否则定时任务会 403。

**2. 全员默认密码**

10 个账号仍是 `Admin@123`，现在有了横幅提醒，但还没强制。

### 长期建议

| 项 | 说明 |
|---|---|
| 附件在线预览 | 现在只能下载 |
| 备份一键恢复 | 现在只能备份 |
| 数据归档 | 长期运行后查询变慢 |
| 部门组织树 | 只有 dept 文本字段 |
| 金额字段重命名 | `_cents` → `_wanx10000`，需数据迁移 |

---

## 八、代码变更清单

```
新增：
  lib/mask.ts                              金额遮蔽统一工具
  app/api/attachments/download/route.ts    附件下载（补齐缺口）
  db/migrations/020_must_change_pwd.sql    首次改密标记

修改：
  app/api/admin/roles/route.ts             GET 加管理员校验
  app/api/jobs/route.ts                    GET 加管理员校验 + token 加固
  app/api/jobs/config/route.ts             token 加固
  app/api/projects/route.ts                列表金额遮蔽
  app/api/contracts/route.ts               金额遮蔽
  app/api/changes/route.ts                 金额遮蔽
  app/api/auth/me/route.ts                 改用动态菜单
  app/api/auth/login/route.ts              返回 mustChangePwd
  app/api/projects/node/route.ts           加 ORDER BY seq
  app/api/attachments/route.ts             接入魔数校验
  lib/jobs.ts                              节点 late 状态自动同步
  lib/captcha.ts                           密钥不再硬编码
  lib/storage.ts                           文件魔数校验
  lib/domain.ts                            金额单位说明
  lib/auth.ts                              mustChangePwd 支持
  components/AppShell.tsx                  初始密码提醒横幅
```
