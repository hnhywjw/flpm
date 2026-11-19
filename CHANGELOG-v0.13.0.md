# v0.13.0 更新说明

两项：用户删除功能、文件上传类型收紧。

---

## 1. 人员管理：恢复删除功能

### 问题

操作列只有「编辑」「修改密码」，没有删除。

核查确认：后端从来没有 `deleteUser` 分支，前端也没有按钮 —— **这个功能一直是缺失的**，
不是这轮改坏的。

### 现在的操作列

```
[编辑] [修改密码] [停用/启用] [删除]
```

### 三层保护

| 保护 | 说明 |
|---|---|
| 不能删自己 | 按钮直接禁用，后端也拦 |
| 不能删最后一个管理员 | 否则系统无人可管 |
| 有业务数据不能删 | 负责的项目/合同/工单/投标，必须先转移责任人 |

第三条的例子：

```
该用户还有业务数据（3 个负责的项目、2 份负责的合同），不能删除。
请先转移责任人，或改用「停用」保留其历史记录。
```

### 删除采用「软删除」

不是物理删除，而是：

```sql
UPDATE users SET
  active = 0,
  password_hash = NULL,          -- 无法再登录
  username = '__deleted_13_xxx', -- 释放原用户名
  name = '张三（已删除）'         -- 列表显示用
WHERE id = 13;
DELETE FROM user_roles WHERE user_id = 13;
DELETE FROM sessions WHERE user_id = 13;
```

**为什么不用物理删除**：

审计日志里记录着「谁改了什么」，`audit_logs.user_id` 指向这个用户。
物理删除后，历史记录就变成「一个不存在的 ID 改的」，追溯链断掉。

同时 `username` 改写成 `__deleted_13_时间戳`，这样原用户名可以再注册，
而列表查询加了 `WHERE username NOT LIKE '__deleted_%'`，已删用户不再出现。

### 新增「停用」按钮

很多场景其实不该删除：

```
员工离职但历史数据要保留  →  停用
临时账号不再使用          →  停用
接错数据要清掉            →  删除
```

停用会立即踢下线（删 sessions），但保留全部历史关联。

---

## 2. 文件上传：类型收紧

### 改前白名单

```
.pdf .doc .docx .xls .xlsx .ppt .pptx .txt .csv .md
.png .jpg .jpeg .gif .webp .bmp
.zip .rar .7z        ← 问题在这
```

### 改后白名单

```
文档  .pdf .doc .docx .xls .xlsx .ppt .pptx
文本  .txt .csv .md
图片  .png .jpg .jpeg .gif .webp .bmp
```

### 为什么移除压缩包

| 风险 | 说明 |
|---|---|
| 藏可执行文件 | `资料.zip` 里放 `病毒.exe`，杀毒软件难扫 |
| zip bomb | 几 KB 的文件解压出几十 GB，撑爆磁盘 |
| 绕过魔数校验 | 压缩后内容变了，魔数检查失效 |
| 业务无需求 | 合同、验收单、发票都是单文件 |

如果确实需要批量资料，建议单独开一个「归档上传」入口，配病毒扫描。

### 明确拒绝的类型

```
可执行    .exe .bat .cmd .sh .ps1 .js .vbs .jar .msi .dll
网页脚本  .html .htm .svg .xml        ← .svg 可内嵌 <script>
服务端    .php .jsp .asp .aspx
```

**特别注意 `.svg`**：它是图片，很多人以为安全，但 SVG 是 XML 格式，
可以内嵌 `<script>` 标签。浏览器直接打开会执行。所以不在白名单。

### 新增：文件名安全检查

光看扩展名不够，还要看文件名本身：

| 检查 | 拦截示例 |
|---|---|
| 双扩展名伪装 | `a.exe.pdf`、`a.php.jpg` |
| 隐藏文件 | `.env`、`.htaccess` |
| 非法字符 | 含 `<` `>` `|` `?` `*` 或控制字符 |
| 超长文件名 | 超过 180 字符 |

`a.exe.pdf` 这种：`path.extname()` 只看最后一段得到 `.pdf`，
扩展名检查能过。但中间夹着 `.exe`，说明是刻意伪装。

**放行的正常情况**：`合同.v2.pdf`、`2026年报.xlsx` 这类多点文件名不受影响。

### 前端同步限制

上传按钮加了 `accept` 属性，文件选择框只显示允许的类型：

```html
<input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,
                            .txt,.csv,.md,.png,.jpg,.jpeg,.gif,.webp,.bmp" />
```

这样用户不会选了半天才被拒。

---

## 验证结果

### 用户删除/停用（13 项）

| 验证 | 结果 |
|---|---|
| 创建测试用户 | ✅ id=13 |
| 停用 | ✅ active=0 |
| 启用 | ✅ active=1 |
| 删除 | ✅ 200 |
| 用户名改写 | ✅ `__deleted_13_1793241653551` |
| 密码清空 | ✅ NULL |
| 账号停用 | ✅ active=0 |
| 列表隐藏 | ✅ |
| 禁止删自己 | ✅ 400 |
| 禁止停用自己 | ✅ 400 |

### 文件类型过滤（9 项）

| 文件 | 结果 |
|---|---|
| PDF | ✅ 允许 200 |
| PNG | ✅ 允许 200 |
| ZIP | ✅ 拒绝 400 |
| EXE | ✅ 拒绝 400 |
| HTML | ✅ 拒绝 400 |
| SVG | ✅ 拒绝 400 |
| JS | ✅ 拒绝 400 |
| a.exe.pdf（双扩展名） | ✅ 拒绝「文件名包含可疑的中间扩展名 .exe」|

### 回归

| 项目 | 结果 |
|---|---|
| 单元测试 | **216/216**（新增 14）✅ |
| 类型检查 | 零错误 ✅ |

### 数据清理

测试数据已清除，10 个真实用户完好：

```
王经理 王海涛 李慧 张立群 刘鹏 陈静 赵磊 赵敏 孙浩 管理员
```

---

## 变更清单

```
修改：
  app/api/admin/roles/route.ts   新增 deleteUser / toggleUserActive
  app/settings/RoleAdmin.tsx     操作列加停用、删除按钮 + me 变量
  lib/roles.ts                   列表过滤已删除用户
  lib/storage.ts                 白名单收紧 + 文件名安全检查
  components/AttachmentPanel.tsx 加 accept 限制
  components/FileUploader.tsx    加 accept 限制
  tests/domain.test.mjs          新增 14 个测试
```

---

## 一个建议

现在删除用户前会检查业务数据引用，但**漏了一部分**：

已检查：项目、合同、工单、投标的 `owner_id`

未检查：
```
audit_logs.user_id        审计记录（故意不拦，这是历史）
notifications.user_id     通知（无所谓）
approval_steps.approver   审批记录（历史，不拦）
```

这些是「历史痕迹」，不该阻止删除。当前策略是对的。

但如果将来加了「客户负责人」「物料责任人」这类字段，需要同步加到检查列表里。
